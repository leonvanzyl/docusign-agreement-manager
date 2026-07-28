import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { isDatabaseConnectionError } from "@/lib/db";

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;

export type SessionResult =
  | { status: "ok"; session: Session }
  | { status: "database-unavailable" };

/**
 * Reads the session, distinguishing "nobody is signed in" from "the database is
 * down" so layouts can render a friendly notice for the second case.
 */
export async function tryGetSession(): Promise<SessionResult> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    return { status: "ok", session };
  } catch (error) {
    if (isDatabaseConnectionError(error)) return { status: "database-unavailable" };
    throw error;
  }
}

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * The single place the app asks "who is signed in?" from a server action.
 *
 * A server action is a public endpoint, so every one of them calls this rather
 * than trusting a userId sent from the browser. The session is read from the
 * request cookies on the server — a client-side or middleware-only check can be
 * bypassed and is never the security boundary here.
 */
export async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}
