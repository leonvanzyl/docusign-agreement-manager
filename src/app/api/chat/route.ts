import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { encodeEvent, type AgentStreamEvent } from "@/lib/agent/events";
import { runAgent, type AgentRunOutcome } from "@/lib/agent/run";
import { changesTheRegister } from "@/lib/agent/tools";
import { db } from "@/lib/db";
import { conversation, message, type AgentToolCall } from "@/lib/db/schema";
import { getValidAccessToken } from "@/lib/docusign/connection";
import { getSession } from "@/lib/session";

/**
 * The assistant's turn, streamed.
 *
 * A route handler rather than a server action because the point is to show work as
 * it happens: a server action returns once, so the user would stare at a spinner
 * through an approval workflow and a send with nothing to look at.
 *
 * Errors split at the moment the first byte goes out. Before that they are ordinary
 * HTTP status codes; after it the response is already committed as 200, so failures
 * travel as an `error` event inside the stream instead.
 */

// The Agent SDK runs Claude Code as a child process, which needs Node — not Edge.
export const runtime = "nodejs";

const requestSchema = z.object({
  conversationId: z.uuid().nullable(),
  content: z
    .string()
    .trim()
    .min(1, "Type a message first.")
    .max(4000, "That message is too long — keep it under 4000 characters."),
});

function fail(error: string, status: number) {
  return Response.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  // A route handler is a public endpoint. The user comes from the session cookie,
  // never from the body, so a caller cannot write into somebody else's thread.
  const session = await getSession();
  if (!session) return fail("Your session has expired. Sign in again.", 401);
  const userId = session.user.id;

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0].message, 400);
  const { content } = parsed.data;

  // There is deliberately no credential pre-check here. The agent authenticates as
  // whoever is signed in to Claude Code, which lives in a file the SDK owns — and a
  // file that exists says nothing about whether the login still works. The real
  // answer comes from trying, so a bad login surfaces as `authentication_failed`
  // mid-stream with an instruction to run `claude login`.

  // Refreshes transparently when the stored token is stale, and returns null when
  // the user has no usable grant at all. Fetched before any writing happens so an
  // unconnected user doesn't end up with an orphaned message and no answer.
  const docusignAccessToken = await getValidAccessToken(userId);
  if (!docusignAccessToken) {
    return fail(
      "Connect your Docusign account to use the assistant — it works entirely through Docusign.",
      409,
    );
  }

  let threadId = parsed.data.conversationId;
  let resumeSessionId: string | null = null;

  if (threadId) {
    const [owned] = await db
      .select({ id: conversation.id, agentSessionId: conversation.agentSessionId })
      .from(conversation)
      .where(and(eq(conversation.id, threadId), eq(conversation.userId, userId)))
      .limit(1);

    if (!owned) return fail("That conversation no longer exists.", 404);
    resumeSessionId = owned.agentSessionId;
  } else {
    const [created] = await db
      .insert(conversation)
      .values({
        userId,
        // First message doubles as the thread's name.
        title: content.length > 60 ? `${content.slice(0, 57)}…` : content,
      })
      .returning({ id: conversation.id });
    threadId = created.id;
  }

  const [userMessage] = await db
    .insert(message)
    .values({ conversationId: threadId, role: "user", content })
    .returning();

  const conversationId = threadId;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = (event: AgentStreamEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeEvent(event)));
      };

      // Accumulated here rather than taken from the run's return value, so a reply
      // that fails halfway is still saved — the user keeps what they saw instead of
      // watching it disappear on the next refresh.
      let text = "";
      const toolCalls: AgentToolCall[] = [];
      const byId = new Map<string, AgentToolCall>();

      send({ type: "start", conversationId, userMessage });

      let outcome: AgentRunOutcome | null = null;
      let failure: string | null = null;

      try {
        const run = runAgent({
          prompt: content,
          docusignAccessToken,
          resumeSessionId,
          signal: request.signal,
        });

        while (true) {
          const next = await run.next();
          if (next.done) {
            outcome = next.value;
            break;
          }

          const event = next.value;
          switch (event.type) {
            case "text":
              text += event.delta;
              break;
            case "tool": {
              const call: AgentToolCall = {
                id: event.id,
                name: event.name,
                input: event.input,
                status: "running",
              };
              toolCalls.push(call);
              byId.set(event.id, call);
              break;
            }
            case "tool-result": {
              // Mutating the object already in `toolCalls` — same reference.
              const call = byId.get(event.id);
              if (call) call.status = event.status;
              break;
            }
          }

          send(event);
        }
      } catch (error) {
        failure =
          error instanceof Error
            ? error.message
            : "The assistant hit an unexpected error.";
      }

      try {
        // Only worth a row if something actually happened. A run that failed before
        // the model said anything leaves the thread as it was.
        const worthSaving = text.trim().length > 0 || toolCalls.length > 0;

        if (worthSaving) {
          const [assistantMessage] = await db
            .insert(message)
            .values({
              conversationId,
              role: "assistant",
              content: text.trim() || "(no reply)",
              toolCalls: toolCalls.length > 0 ? toolCalls : null,
            })
            .returning();

          // Sent even when the turn then failed: `done` is what tells the client the
          // draft on screen is now a saved row. Without it a half-finished reply
          // would still be visible but would vanish on the next refresh.
          send({ type: "done", message: assistantMessage });
        }

        // Only calls that came back `ok` count. A send that failed changed nothing
        // in Docusign, and re-importing on the strength of it would be a slow way
        // of finding that out.
        const changed = toolCalls.some(
          (call) => call.status === "ok" && changesTheRegister(call.name),
        );
        if (changed) send({ type: "register-changed" });

        // Recorded even when the turn failed: the SDK session exists from the moment
        // it is created, and keeping the id is what lets the next turn pick up the
        // thread rather than starting over.
        if (outcome?.sessionId && outcome.sessionId !== resumeSessionId) {
          await db
            .update(conversation)
            .set({ agentSessionId: outcome.sessionId })
            .where(eq(conversation.id, conversationId));
        }

        if (failure) send({ type: "error", message: failure });
      } catch {
        send({
          type: "error",
          message: "The reply could not be saved. Check that the database is running.",
        });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Tells nginx-style proxies not to sit on the response — without it the whole
      // stream can arrive at once and the streaming is invisible in production.
      "X-Accel-Buffering": "no",
    },
  });
}
