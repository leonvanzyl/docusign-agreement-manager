import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { DatabaseOffline } from "@/components/database-offline";
import { getConnectionStatus } from "@/lib/docusign/connection";
import { tryGetSession } from "@/lib/session";

/**
 * The security boundary for every signed-in screen, written once. Pages and
 * server actions underneath still re-check the session where they run — this
 * layout keeps signed-out users out, it does not authorise individual reads.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await tryGetSession();
  if (result.status === "database-unavailable") return <DatabaseOffline />;
  if (!result.session) redirect("/sign-in");

  const { user } = result.session;

  // Only the usable/not-usable verdict reaches the client — never the tokens themselves.
  const docusignStatus = await getConnectionStatus(user.id);

  return (
    // Fixed-height shell: the nav stays put and each screen scrolls its own
    // content, so the chat composer can pin to the bottom without magic numbers.
    <div className="flex h-svh flex-col overflow-hidden">
      <AppNav
        user={{ name: user.name, email: user.email }}
        docusignStatus={docusignStatus}
      />
      {children}
    </div>
  );
}
