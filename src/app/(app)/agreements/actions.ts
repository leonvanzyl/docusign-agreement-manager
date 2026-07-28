"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { agreement } from "@/lib/db/schema";
import { syncRegister } from "@/lib/docusign/sync";
import { requireSession } from "@/lib/session";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type SyncResult =
  | { ok: true; total: number; created: number; removed: number }
  | { ok: false; error: string };

/**
 * Rebuilds the table from Docusign.
 *
 * Called from the button on this page and, automatically, by the chat panel the
 * moment the agent does something that changes what Docusign holds — so an
 * agreement sent in conversation is in the register by the time the user looks.
 */
export async function syncAgreements(): Promise<SyncResult> {
  // A server action is a public endpoint. The Docusign account read here is the
  // one belonging to whoever is signed in, taken from the session and nowhere else.
  const session = await requireSession();

  const result = await syncRegister(session.user.id);
  if (!result.ok) return result;

  revalidatePath("/agreements");
  return {
    ok: true,
    total: result.total,
    created: result.created,
    removed: result.removed,
  };
}

export async function deleteAgreement(id: string): Promise<ActionResult> {
  // A server action is a public endpoint — the session is re-checked here, not
  // trusted from the caller, and userId comes from the session rather than the body.
  const session = await requireSession();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, error: "That agreement no longer exists." };
  }

  // The userId in the WHERE clause is what stops one user deleting another's row.
  const deleted = await db
    .delete(agreement)
    .where(and(eq(agreement.id, id), eq(agreement.userId, session.user.id)))
    .returning({ id: agreement.id });

  if (deleted.length === 0) {
    return { ok: false, error: "That agreement no longer exists." };
  }

  revalidatePath("/agreements");
  return { ok: true };
}

/** Offsets are relative to today so the expiring-soon cue is actually visible. */
function dateFromToday(offsetDays: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

/**
 * Explicitly user-triggered from the empty state. Nothing appears on its own —
 * these rows belong to the signed-in user like any other.
 */
export async function loadSampleAgreements(): Promise<ActionResult> {
  const session = await requireSession();

  const samples = [
    {
      title: "Master Services Agreement",
      counterparty: "Acme Industrial",
      type: "msa" as const,
      status: "in_review" as const,
      valueCents: 48_000_000,
      owner: "Priya Raman",
      effectiveDate: dateFromToday(-210),
      expiryDate: dateFromToday(155),
    },
    {
      title: "Mutual NDA",
      counterparty: "Vertex Analytics",
      type: "nda" as const,
      status: "executed" as const,
      valueCents: null,
      owner: "Daniel Osei",
      effectiveDate: dateFromToday(-95),
      expiryDate: dateFromToday(635),
    },
    {
      title: "Statement of Work #4 — Platform Migration",
      counterparty: "Northwind Logistics",
      type: "sow" as const,
      status: "draft" as const,
      valueCents: 12_500_000,
      owner: "Priya Raman",
      effectiveDate: null,
      expiryDate: null,
    },
    {
      title: "Data Processing Addendum",
      counterparty: "Lumen Cloud",
      type: "dpa" as const,
      status: "out_for_signature" as const,
      valueCents: null,
      owner: "Sarah Whitfield",
      effectiveDate: dateFromToday(-14),
      expiryDate: dateFromToday(21),
    },
    {
      title: "Order Form — Enterprise Seats (Renewal)",
      counterparty: "Kestrel Software",
      type: "order_form" as const,
      status: "executed" as const,
      valueCents: 9_600_000,
      owner: "Daniel Osei",
      effectiveDate: dateFromToday(-330),
      expiryDate: dateFromToday(28),
    },
    {
      title: "Reseller Agreement",
      counterparty: "Halden Partners",
      type: "msa" as const,
      status: "expired" as const,
      valueCents: 3_200_000,
      owner: "Sarah Whitfield",
      effectiveDate: dateFromToday(-760),
      expiryDate: dateFromToday(-30),
    },
  ];

  await db
    .insert(agreement)
    .values(samples.map((row) => ({ ...row, userId: session.user.id })));

  revalidatePath("/agreements");
  return { ok: true };
}
