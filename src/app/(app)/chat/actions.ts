"use server";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { conversation, message, type Message } from "@/lib/db/schema";
import { requireSession } from "@/lib/session";

/**
 * Sending a message is not here — it streams, so it lives in the route handler at
 * `src/app/api/chat/route.ts`. A server action can only return once, which would
 * hide every tool call behind a spinner until the whole turn finished.
 */

export async function loadMessages(conversationId: string): Promise<Message[]> {
  const session = await requireSession();

  const owned = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(
      and(
        eq(conversation.id, conversationId),
        eq(conversation.userId, session.user.id),
      ),
    )
    .limit(1);

  if (owned.length === 0) return [];

  return db
    .select()
    .from(message)
    .where(eq(message.conversationId, conversationId))
    .orderBy(asc(message.createdAt));
}
