import { asc, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DatabaseOffline } from "@/components/database-offline";
import { db, tryQuery } from "@/lib/db";
import { conversation, message } from "@/lib/db/schema";
import { getConnectionStatus } from "@/lib/docusign/connection";
import { tryGetSession } from "@/lib/session";

import { ChatPanel } from "./chat-panel";

export const metadata: Metadata = { title: "Assistant" };

export default async function ChatPage() {
  // Next renders this page in parallel with the layout, so the layout's guard
  // doesn't cover it — the check has to be repeated here.
  const auth = await tryGetSession();
  if (auth.status === "database-unavailable") return <DatabaseOffline />;
  if (!auth.session) redirect("/sign-in");
  const session = auth.session;

  const result = await tryQuery(async () => {
    // Pick up the most recent thread so a refresh doesn't lose the conversation.
    const [latest] = await db
      .select()
      .from(conversation)
      .where(eq(conversation.userId, session.user.id))
      .orderBy(desc(conversation.createdAt))
      .limit(1);

    const messages = latest
      ? await db
          .select()
          .from(message)
          .where(eq(message.conversationId, latest.id))
          .orderBy(asc(message.createdAt))
      : [];

    // The agent reaches Docusign through MCP, so a thread it can't act on is worth
    // saying up front rather than after the first question fails.
    const docusignStatus = await getConnectionStatus(session.user.id);

    return { latest, messages, docusignStatus };
  });

  if (result.status === "database-unavailable") return <DatabaseOffline />;

  return (
    <ChatPanel
      initialConversationId={result.data.latest?.id ?? null}
      initialMessages={result.data.messages}
      docusignStatus={result.data.docusignStatus}
    />
  );
}
