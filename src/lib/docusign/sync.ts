import "server-only";

import { and, eq, inArray, max, ne, notInArray, sql } from "drizzle-orm";

import { fetchDocusignRegister } from "@/lib/agent/sync";
import { db } from "@/lib/db";
import { agreement } from "@/lib/db/schema";

import { mergeRegister, type RegisterItem } from "./agreements";
import { getValidAccessToken } from "./connection";

/**
 * Refreshing the agreements table from Docusign, end to end.
 *
 * Read the two sources through the agent, collapse them into one list, and write
 * that list into the register. The write is a snapshot rather than an append: a
 * row the user added by hand is never touched, and a Docusign-sourced row that no
 * longer exists upstream goes away, so the table cannot slowly fill with envelopes
 * that were voided months ago.
 */

/** Postgres caps parameters per statement; 16 columns a row leaves plenty of room. */
const INSERT_CHUNK = 500;

export type RegisterSyncResult =
  | {
      ok: true;
      /** Rows the merge produced — after de-duplication, so less than the two lists. */
      total: number;
      created: number;
      updated: number;
      removed: number;
      /** Entries the agent returned that could not be read. */
      skipped: number;
      syncedAt: Date;
    }
  | { ok: false; error: string };

function toRow(item: RegisterItem, userId: string, syncedAt: Date) {
  return {
    userId,
    title: item.title,
    counterparty: item.counterparty,
    type: item.type,
    status: item.status,
    valueCents: item.valueCents,
    currency: item.currency,
    owner: item.owner,
    effectiveDate: item.effectiveDate,
    expiryDate: item.expiryDate,
    source: item.source,
    envelopeId: item.envelopeId,
    agreementId: item.agreementId,
    externalKey: item.externalKey,
    lastSyncedAt: syncedAt,
  };
}

/**
 * Every synced column is overwritten from the incoming row.
 *
 * Docusign is the record of truth for anything it imported, so an edit made here
 * would be undone on the next sync anyway — better that it is never possible to
 * make than that it silently disappears later. Rows the user created by hand have
 * a null `externalKey`, never collide, and are left completely alone.
 */
const OVERWRITE_FROM_INCOMING = {
  title: sql`excluded.title`,
  counterparty: sql`excluded.counterparty`,
  type: sql`excluded.type`,
  status: sql`excluded.status`,
  valueCents: sql`excluded.value_cents`,
  currency: sql`excluded.currency`,
  owner: sql`excluded.owner`,
  effectiveDate: sql`excluded.effective_date`,
  expiryDate: sql`excluded.expiry_date`,
  source: sql`excluded.source`,
  envelopeId: sql`excluded.envelope_id`,
  agreementId: sql`excluded.agreement_id`,
  lastSyncedAt: sql`excluded.last_synced_at`,
  updatedAt: sql`now()`,
};

export async function syncRegister(userId: string): Promise<RegisterSyncResult> {
  // Refreshes a stale token transparently, and returns null when the user has no
  // usable grant — the same state the UI already shows as "connect Docusign".
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    return {
      ok: false,
      error: "Connect your Docusign account first — the register is imported from it.",
    };
  }

  const fetched = await fetchDocusignRegister(accessToken);
  if (!fetched.ok) return { ok: false, error: fetched.error };

  const items = mergeRegister(fetched.payload);
  const syncedAt = new Date();
  const keys = items.map((item) => item.externalKey);

  if (items.length === 0) {
    // Nothing came back. That is a real answer for a fresh Docusign account, but it
    // is also what a half-failed listing looks like — so it is reported, and
    // deliberately does *not* prune. Emptying someone's register on the strength of
    // an empty response is the one mistake here that cannot be undone.
    return {
      ok: true,
      total: 0,
      created: 0,
      updated: 0,
      removed: 0,
      skipped: fetched.payload.skipped,
      syncedAt,
    };
  }

  // Which keys are already here decides created-vs-updated. Read before the write,
  // because afterwards every one of them exists.
  const existing = await db
    .select({ externalKey: agreement.externalKey })
    .from(agreement)
    .where(and(eq(agreement.userId, userId), inArray(agreement.externalKey, keys)));

  const existingKeys = new Set(existing.map((row) => row.externalKey));

  for (let start = 0; start < items.length; start += INSERT_CHUNK) {
    const chunk = items.slice(start, start + INSERT_CHUNK);
    await db
      .insert(agreement)
      .values(chunk.map((item) => toRow(item, userId, syncedAt)))
      .onConflictDoUpdate({
        target: [agreement.userId, agreement.externalKey],
        set: OVERWRITE_FROM_INCOMING,
      });
  }

  // Anything imported previously and absent now is gone from Docusign — deleted,
  // or purged. `ne(source, "manual")` is what keeps the user's own rows out of it.
  const removed = await db
    .delete(agreement)
    .where(
      and(
        eq(agreement.userId, userId),
        ne(agreement.source, "manual"),
        notInArray(agreement.externalKey, keys),
      ),
    )
    .returning({ id: agreement.id });

  const created = items.filter((item) => !existingKeys.has(item.externalKey)).length;

  return {
    ok: true,
    total: items.length,
    created,
    updated: items.length - created,
    removed: removed.length,
    skipped: fetched.payload.skipped,
    syncedAt,
  };
}

/** When this user's register last came back from Docusign, or null if it never has. */
export async function getLastSyncedAt(userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(agreement.lastSyncedAt) })
    .from(agreement)
    .where(eq(agreement.userId, userId));

  return row?.at ?? null;
}
