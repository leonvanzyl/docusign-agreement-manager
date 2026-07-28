import "server-only";

import type { Options } from "@anthropic-ai/claude-agent-sdk";

import { getDocusignConfig } from "@/lib/docusign/config";

import { AGENT_MODEL, buildAgentEnv } from "./config";
import { DOCUSIGN_MCP_SERVER, DOCUSIGN_TOOL_PATTERN } from "./tools";

/**
 * The one description of what this app's agent is allowed to be.
 *
 * The Claude Agent SDK is Claude Code as a library: left alone it would arrive with
 * a shell, a file editor, and this repository's own settings. None of that belongs
 * in a request handler, so the agent is stripped down to exactly one capability —
 * the Docusign MCP server — and every other door is closed explicitly below.
 *
 * There are two callers: the chat turn a user watches, and the headless sync that
 * fills the agreements table. Sharing this builder is what stops the second one
 * from quietly being the more permissive of the two.
 */

export type DocusignAgentOptions = {
  /** Replaces Claude Code's own prompt outright — see the note below. */
  systemPrompt: string;
  /** A Docusign access token valid *now* — refreshing is the caller's job. */
  docusignAccessToken: string;
  maxTurns: number;
  signal: AbortSignal;
  /** A prior SDK session to continue, for callers that have one. */
  resumeSessionId?: string | null;
  /** Only the chat turn streams; the sync just wants the final answer. */
  includePartialMessages?: boolean;
};

export function buildDocusignAgentOptions(config: DocusignAgentOptions): Options {
  // Resolved together with the account host, so a demo token can never be pointed
  // at the production MCP endpoint.
  const { mcpUrl } = getDocusignConfig();

  // The SDK wants to own its controller, so the caller's signal is mirrored onto
  // one rather than passed through.
  const abortController = new AbortController();
  if (config.signal.aborted) abortController.abort();
  else {
    config.signal.addEventListener("abort", () => abortController.abort(), {
      once: true,
    });
  }

  return {
    model: AGENT_MODEL,
    // A plain string replaces Claude Code's own prompt outright. Using the
    // `claude_code` preset instead would graft a software-engineering persona and a
    // toolbox this agent doesn't have onto an agreements assistant.
    systemPrompt: config.systemPrompt,

    mcpServers: {
      [DOCUSIGN_MCP_SERVER]: {
        type: "http",
        url: mcpUrl,
        // The token's only job. It authorises the MCP connection and is never
        // handed to the model, never logged, and never sent to the browser.
        headers: { Authorization: `Bearer ${config.docusignAccessToken}` },
        // MCP servers connect in the background by default, so the first turn can
        // begin before the tools exist. For an agent whose *only* capability is
        // this server that means turn one answers "I can't do that" — so startup
        // waits for the connection instead. Also keeps the handful of Docusign
        // tools in the prompt rather than behind tool search.
        alwaysLoad: true,
      },
    },

    // No built-in tools at all: no Bash, no Read, no Write. The server's filesystem
    // is not part of this feature, so the agent is given no way to reach it.
    tools: [],
    // MCP tools still need granting on top of being available. A server-scoped
    // wildcard is narrower than `permissionMode: "bypassPermissions"`, which would
    // also switch off the safety prompts guarding everything else.
    allowedTools: [DOCUSIGN_TOOL_PATTERN],

    // Ignore ~/.claude, .claude/, CLAUDE.md and .mcp.json. Whatever a developer has
    // configured for their own Claude Code should not change how this app behaves
    // for its users — and .mcp.json in particular could otherwise attach servers
    // this agent was never meant to have.
    settingSources: [],
    strictMcpConfig: true,

    // The SDK keeps the real transcript, including tool results. Resuming by id is
    // what lets "yes, send it" refer back to the envelope proposed a turn earlier.
    ...(config.resumeSessionId ? { resume: config.resumeSessionId } : {}),

    includePartialMessages: config.includePartialMessages ?? false,
    maxTurns: config.maxTurns,
    abortController,

    // Claude Code OAuth, with any stray API key stripped out — see `buildAgentEnv`.
    env: buildAgentEnv(),
  };
}

/**
 * Whether the Docusign MCP server came up.
 *
 * `alwaysLoad` means the connection has been attempted by the time the init message
 * arrives, so a bad status here is final. Docusign is this agent's only capability —
 * without it the model would still answer, just with nothing behind the answer, so
 * failing loudly beats a confident reply about an envelope nobody sent.
 */
export function docusignServerFailed(
  servers: { name: string; status: string }[],
): boolean {
  const docusign = servers.find((server) => server.name === DOCUSIGN_MCP_SERVER);
  return docusign?.status === "failed" || docusign?.status === "needs-auth";
}

export const DOCUSIGN_UNREACHABLE =
  "Couldn't reach Docusign. Try disconnecting and reconnecting your Docusign account.";
