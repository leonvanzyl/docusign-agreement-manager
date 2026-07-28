/**
 * How Docusign's MCP tools are named and how those names are shown.
 *
 * Client-safe on purpose — the chat UI renders tool names, so this cannot live
 * beside the API key and system prompt in `config.ts`.
 */

/**
 * The name the Docusign MCP server is registered under. It becomes part of every
 * tool name the agent sees (`mcp__docusign__<tool>`), so the permission pattern
 * below is derived from it rather than written out twice.
 */
export const DOCUSIGN_MCP_SERVER = "docusign";

/** Grants every tool the Docusign server exposes, and nothing else. */
export const DOCUSIGN_TOOL_PATTERN = `mcp__${DOCUSIGN_MCP_SERVER}__*`;

/** `mcp__docusign__send_envelope` → `send_envelope`. */
function stripNamespace(name: string): string {
  return name
    .replace(`mcp__${DOCUSIGN_MCP_SERVER}__`, "")
    .replace(/^mcp__[^_]+__/, "");
}

/**
 * `mcp__docusign__send_envelope` → `Send envelope`.
 *
 * Falls back to the raw name if it doesn't match the expected shape, because an
 * unrecognised tool name is still more useful on screen than a blank label.
 */
export function toolDisplayName(name: string): string {
  const bare = stripNamespace(name).replace(/[_-]+/g, " ").trim();

  if (!bare) return name;
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

/**
 * Tool names that mean "something in Docusign changed".
 *
 * Matched on the leading verb, since MCP tools are named verb-first
 * (`send_envelope`, `create_envelope`, `void_envelope`). Docusign owns this list
 * and can add to it, so the test is a deliberately plain one — a verb that acts,
 * rather than a hard-coded set of tool names that would go stale silently.
 */
const ACTING_VERBS = new Set([
  "send",
  "resend",
  "create",
  "add",
  "update",
  "correct", // Docusign's word for editing an envelope already out
  "void",
  "cancel",
  "delete",
  "remove",
  "terminate",
  "sign",
  "complete",
  "execute",
  "trigger",
  "start",
  "launch",
  "initiate",
]);

/**
 * Whether a tool call can have changed what the agreements table should show.
 *
 * Used to decide when to re-import after a chat turn. It errs towards syncing: a
 * needless refresh costs a little time, while a missed one leaves a freshly sent
 * agreement invisible until the user thinks to press the button — which is exactly
 * the gap the table exists to close.
 */
export function changesTheRegister(name: string): boolean {
  const verb = stripNamespace(name)
    // `sendEnvelope` and `send_envelope` are the same call named two ways.
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_-]/)[0];

  return ACTING_VERBS.has(verb);
}
