import "server-only";

import { query } from "@anthropic-ai/claude-agent-sdk";

import {
  parseRegisterPayload,
  type DocusignRegisterPayload,
} from "@/lib/docusign/agreements";

import { SYNC_PROMPT, SYNC_SYSTEM_PROMPT } from "./config";
import {
  buildDocusignAgentOptions,
  DOCUSIGN_UNREACHABLE,
  docusignServerFailed,
} from "./options";

/**
 * Reads both Docusign sources through the agent and hands back structured data.
 *
 * The agent is the Docusign client here, exactly as it is in chat — this app has no
 * second, direct integration. That is deliberate: the MCP server decides what tools
 * exist and what they are called, and hard-coding REST calls beside it would be a
 * copy that drifts. What comes back is a payload, not prose, so everything after
 * this point is ordinary typed data.
 *
 * No streaming and no session to resume: this run has nothing to say to anybody.
 */

/** Listing two products with pagination takes a handful of calls, not dozens. */
const MAX_TURNS = 20;

/**
 * Bounds a run nobody is watching.
 *
 * A user-facing turn is bounded by the request — close the tab and it aborts. This
 * one is started by a server action and would otherwise sit there.
 */
const TIMEOUT_MS = 3 * 60 * 1000;

export type RegisterFetchResult =
  | { ok: true; payload: DocusignRegisterPayload }
  | { ok: false; error: string };

/**
 * Pulls the JSON document out of the agent's reply.
 *
 * The prompt asks for a bare fenced block, and models mostly comply — but "mostly"
 * is not good enough when the alternative is an empty register, so a stray sentence
 * either side is tolerated. The fence is tried first; failing that, the outermost
 * braces. Anything else is a genuine failure and is reported as one.
 */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];

  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate — a fenced block can itself be truncated.
    }
  }
  return null;
}

export async function fetchDocusignRegister(
  docusignAccessToken: string,
): Promise<RegisterFetchResult> {
  const options = buildDocusignAgentOptions({
    systemPrompt: SYNC_SYSTEM_PROMPT,
    docusignAccessToken,
    maxTurns: MAX_TURNS,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  let text = "";
  let errorCode: string | undefined;

  try {
    for await (const message of query({ prompt: SYNC_PROMPT, options })) {
      if (message.type === "system" && message.subtype === "init") {
        if (docusignServerFailed(message.mcp_servers)) {
          return { ok: false, error: DOCUSIGN_UNREACHABLE };
        }
        continue;
      }

      if (message.type === "assistant" && message.error) {
        errorCode = message.error;
        continue;
      }

      if (message.type === "result") {
        if (message.subtype === "success") text = message.result;
        else if (message.subtype === "error_max_turns") {
          return {
            ok: false,
            error: "Reading your Docusign account took too many steps. Try again.",
          };
        }
      }
    }
  } catch (error) {
    // A timeout arrives here as an abort, and reads as an SDK crash otherwise.
    if (error instanceof Error && error.name === "TimeoutError") {
      return { ok: false, error: "Docusign took too long to respond. Try again." };
    }
    return {
      ok: false,
      error:
        errorCode === "authentication_failed"
          ? "Claude Code isn't signed in, or its login has expired. Run `claude login` in a terminal, then try again."
          : "Couldn't read your Docusign account just now.",
    };
  }

  if (!text.trim()) {
    return { ok: false, error: "Docusign returned nothing to import." };
  }

  const payload = parseRegisterPayload(extractJson(text));
  if (!payload) {
    // Distinguished from an empty account on purpose: "nothing there" and "the
    // answer was unreadable" call for completely different responses from a user.
    return { ok: false, error: "The Docusign data came back in an unexpected shape." };
  }

  return { ok: true, payload };
}
