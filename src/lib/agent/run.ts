import "server-only";

import { query } from "@anthropic-ai/claude-agent-sdk";

import type { AgentToolCall } from "@/lib/db/schema";

import { AGENT_MODEL, SYSTEM_PROMPT } from "./config";
import {
  buildDocusignAgentOptions,
  DOCUSIGN_UNREACHABLE,
  docusignServerFailed,
} from "./options";

/**
 * Runs one turn of the agreement agent and narrates it as it happens.
 *
 * What the agent is allowed to touch — one MCP server and nothing else — is
 * defined once in `options.ts` and shared with the headless register sync.
 */

export type AgentRunEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; id: string; name: string; input: unknown }
  | { type: "tool-result"; id: string; status: "ok" | "error" };

export type AgentRunOutcome = {
  /** The full reply, assembled from the same deltas that were streamed. */
  text: string;
  toolCalls: AgentToolCall[];
  /** The SDK session to resume next turn, or null if it never reported one. */
  sessionId: string | null;
};

export type AgentRunConfig = {
  prompt: string;
  /** A Docusign access token valid *now* — refreshing is the caller's job. */
  docusignAccessToken: string;
  /** Prior SDK session for this thread, if there is one. */
  resumeSessionId: string | null;
  signal: AbortSignal;
};

/** Enough turns for confirm → approve → send; low enough to bound a runaway loop. */
const MAX_TURNS = 24;

/**
 * Turns the SDK's error codes into something a user of *this* app can act on.
 *
 * Worth the table: these arrive on the assistant message while the run's own result
 * can still report `success`, and the raw failure that follows reads
 * "Claude Code returned an error result: Invalid API key" — which points at the
 * wrong product entirely.
 */
const ERROR_MESSAGES: Record<string, string> = {
  authentication_failed:
    "Claude Code isn't signed in, or its login has expired. Run `claude login` in a terminal, then try again.",
  oauth_org_not_allowed:
    "This Claude Code account isn't allowed to use the API. Check its organisation.",
  billing_error:
    "The Claude account behind this login has a billing problem — check it at claude.ai.",
  rate_limit:
    "The Claude Code subscription hit its rate limit. Try again in a few minutes.",
  overloaded: "The model is busy right now. Try again in a moment.",
  model_not_found: `The model "${AGENT_MODEL}" isn't available to this token.`,
  invalid_request: "The assistant sent a request the API rejected.",
  server_error: "Anthropic had a server error. Try again in a moment.",
  max_output_tokens: "The reply was too long and was cut off.",
};

/**
 * A failure that starting a fresh session would not fix.
 *
 * The retry below exists for one case — a stored session id whose transcript is
 * gone. Marking everything else keeps an outage from being paid for twice.
 */
class FatalAgentError extends Error {}

function describeError(code: string | undefined, fallback: unknown): string {
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  if (fallback instanceof Error && fallback.message) return fallback.message;
  return "The assistant hit an unexpected error.";
}

function buildOptions(config: AgentRunConfig, resumeSessionId: string | null) {
  return buildDocusignAgentOptions({
    systemPrompt: SYSTEM_PROMPT,
    docusignAccessToken: config.docusignAccessToken,
    maxTurns: MAX_TURNS,
    signal: config.signal,
    resumeSessionId,
    // The point of this route is showing work as it happens, so text arrives token
    // by token rather than as one finished block.
    includePartialMessages: true,
  });
}

/** Tracks whether anything reached the client, which decides if a retry is safe. */
type Progress = { emitted: number };

async function* streamOnce(
  config: AgentRunConfig,
  resumeSessionId: string | null,
  progress: Progress,
): AsyncGenerator<AgentRunEvent, AgentRunOutcome> {
  const options = buildOptions(config, resumeSessionId);

  let text = "";
  let sessionId: string | null = null;
  const toolCalls: AgentToolCall[] = [];
  const byId = new Map<string, AgentToolCall>();

  // The SDK reports auth, billing and rate-limit failures here and *then* throws a
  // less useful message, so the last one seen is kept to explain the throw.
  let lastErrorCode: string | undefined;

  try {
    for await (const message of query({ prompt: config.prompt, options })) {
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
        if (docusignServerFailed(message.mcp_servers)) {
          throw new FatalAgentError(DOCUSIGN_UNREACHABLE);
        }
        continue;
      }

      // Token-level text. The accumulator is fed from these same deltas rather than
      // from the completed assistant message, so what gets saved is character for
      // character what the user watched appear.
      if (message.type === "stream_event") {
        if (message.parent_tool_use_id) continue; // subagent chatter — not shown

        const event = message.event;

        // A second text block means a new turn after a tool ran. Without a break
        // the reply would run "…confirm?Sent." together.
        if (
          event.type === "content_block_start" &&
          event.content_block.type === "text" &&
          text.length > 0
        ) {
          text += "\n\n";
          progress.emitted++;
          yield { type: "text", delta: "\n\n" };
        }

        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          text += event.delta.text;
          progress.emitted++;
          yield { type: "text", delta: event.delta.text };
        }
        continue;
      }

      // Tool calls are read from the completed assistant message, where the
      // arguments are already parsed — the streamed form arrives as partial JSON.
      if (message.type === "assistant") {
        sessionId ??= message.session_id;
        if (message.error) lastErrorCode = message.error;

        for (const block of message.message.content) {
          if (block.type !== "tool_use") continue;

          const call: AgentToolCall = {
            id: block.id,
            name: block.name,
            input: block.input,
            status: "running",
          };
          toolCalls.push(call);
          byId.set(block.id, call);

          progress.emitted++;
          yield { type: "tool", id: block.id, name: block.name, input: block.input };
        }
        continue;
      }

      // Tool results come back addressed to the model as user-role messages.
      if (message.type === "user") {
        const content = message.message.content;
        if (typeof content === "string") continue;

        for (const block of content) {
          if (block.type !== "tool_result") continue;

          const call = byId.get(block.tool_use_id);
          if (!call) continue;

          call.status = block.is_error ? "error" : "ok";
          progress.emitted++;
          yield { type: "tool-result", id: block.tool_use_id, status: call.status };
        }
        continue;
      }

      if (message.type === "result") {
        sessionId ??= message.session_id;

        if (message.subtype !== "success") {
          // Turn limits and execution failures arrive here as data, not as a throw.
          throw new Error(
            message.errors?.join("; ") ||
              (message.subtype === "error_max_turns"
                ? "The assistant stopped after too many steps without finishing."
                : describeError(lastErrorCode, null)),
          );
        }

        // A failed run can still report `subtype: "success"` with an empty result —
        // an invalid API key looks exactly like this. Without the code carried over
        // from the assistant message it would read as the agent simply saying
        // nothing.
        if (!text.trim() && !toolCalls.length && lastErrorCode) {
          throw new Error(describeError(lastErrorCode, null));
        }

        // Nothing streamed — the whole reply was a single non-streamed block.
        if (!text.trim() && message.result.trim()) {
          text = message.result;
          progress.emitted++;
          yield { type: "text", delta: message.result };
        }
      }
    }
  } catch (error) {
    if (error instanceof FatalAgentError) throw error;

    // The SDK's own throw is phrased for a terminal ("Claude Code returned an error
    // result: Invalid API key"), which points at the wrong product. When a code was
    // reported earlier in the run it explains the failure far better.
    if (lastErrorCode) throw new FatalAgentError(describeError(lastErrorCode, error));
    throw error;
  }

  return { text: text.trim(), toolCalls, sessionId };
}

export async function* runAgent(
  config: AgentRunConfig,
): AsyncGenerator<AgentRunEvent, AgentRunOutcome> {
  const progress: Progress = { emitted: 0 };

  try {
    return yield* streamOnce(config, config.resumeSessionId, progress);
  } catch (error) {
    // Sessions live on disk next to the SDK, not in Postgres, so a stored id can
    // outlive the transcript it points at. Starting over loses context but still
    // answers the user; only safe while the client has seen nothing, since a retry
    // would otherwise duplicate text already on their screen — and pointless for a
    // failure a new session would hit just the same.
    if (
      config.resumeSessionId &&
      progress.emitted === 0 &&
      !(error instanceof FatalAgentError)
    ) {
      return yield* streamOnce(config, null, progress);
    }
    throw error;
  }
}
