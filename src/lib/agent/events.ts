import type { AgentToolCall, Message } from "@/lib/db/schema";

/**
 * The wire format between the streaming chat route and the browser.
 *
 * Deliberately its own small vocabulary rather than the SDK's message union: the
 * client should not have to know what a `stream_event` or a `parent_tool_use_id`
 * is, and narrowing here means an SDK upgrade can't quietly change what the UI
 * receives.
 *
 * Shared by both sides — so no `server-only` import in this file.
 */
export type AgentStreamEvent =
  /** Sent once, before any model work, so the client can pin a new thread's id. */
  | { type: "start"; conversationId: string; userMessage: Message }
  /** A chunk of reply text. Concatenated in arrival order. */
  | { type: "text"; delta: string }
  /** The agent has called a Docusign tool. Surfaced immediately, before it returns. */
  | { type: "tool"; id: string; name: string; input: unknown }
  /** That tool came back. Pairs with `tool` on `id`. */
  | { type: "tool-result"; id: string; status: "ok" | "error" }
  /** Terminal success: the persisted assistant row, which replaces the streamed draft. */
  | { type: "done"; message: Message }
  /**
   * The turn changed something in Docusign, so the agreements table is now stale.
   *
   * Sent rather than acted on: re-importing is another agent run, and holding the
   * stream open for it would leave the user watching a finished conversation spin.
   * The client picks this up and refreshes in the background.
   */
  | { type: "register-changed" }
  /** Terminal failure. Whatever text streamed before this is still on screen. */
  | { type: "error"; message: string };

/** Newline-delimited JSON: one event per line, flushed as it happens. */
export function encodeEvent(event: AgentStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Splits an NDJSON byte stream into events.
 *
 * A chunk boundary can land mid-line, so the trailing partial line is held back
 * and prepended to the next chunk rather than being parsed and thrown away.
 */
export async function* decodeEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AgentStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as AgentStreamEvent;
      }
    }

    const remainder = buffer.trim();
    if (remainder) yield JSON.parse(remainder) as AgentStreamEvent;
  } finally {
    reader.releaseLock();
  }
}

export type { AgentToolCall };
