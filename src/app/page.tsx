import { redirect } from "next/navigation";

import { DatabaseOffline } from "@/components/database-offline";
import { tryGetSession } from "@/lib/session";

/**
 * Not a screen of its own. An internal tool doesn't need a marketing front door,
 * so `/` just routes to the right place: the register when signed in, the login
 * screen when not.
 */
export default async function RootPage() {
  const result = await tryGetSession();
  if (result.status === "database-unavailable") return <DatabaseOffline />;
  redirect(result.session ? "/agreements" : "/sign-in");
}
