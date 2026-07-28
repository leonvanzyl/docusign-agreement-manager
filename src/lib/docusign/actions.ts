"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/session";

import { deleteConnection } from "./connection";

/**
 * Drops the stored Docusign tokens for the signed-in user.
 *
 * Local only: it forgets this app's copy of the grant. Revoking the app's access at
 * Docusign is done from the user's Docusign account settings.
 */
export async function disconnectDocusign(): Promise<{ ok: true }> {
  // A server action is a public endpoint — the user comes from the session, so
  // this can only ever delete the caller's own connection.
  const session = await requireSession();
  await deleteConnection(session.user.id);

  revalidatePath("/", "layout");
  return { ok: true };
}
