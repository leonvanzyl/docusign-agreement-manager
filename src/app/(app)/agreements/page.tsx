import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DatabaseOffline } from "@/components/database-offline";
import { db, tryQuery } from "@/lib/db";
import { agreement } from "@/lib/db/schema";
import {
  EXPIRING_SOON_DAYS,
  expiryTone,
  formatMoney,
  formatTimeAgo,
} from "@/lib/agreements";
import { getConnectionStatus } from "@/lib/docusign/connection";
import { getLastSyncedAt } from "@/lib/docusign/sync";
import { tryGetSession } from "@/lib/session";

import { AgreementsTable } from "./agreements-table";
import { SyncButton } from "./sync-button";

export const metadata: Metadata = { title: "Agreements" };

export default async function AgreementsPage() {
  // Next renders this page in parallel with the layout, so the layout's guard
  // doesn't cover it — the check has to be repeated here.
  const auth = await tryGetSession();
  if (auth.status === "database-unavailable") return <DatabaseOffline />;
  if (!auth.session) redirect("/sign-in");
  const session = auth.session;

  // Scoped to the signed-in user. Agreements are private in this version, so
  // there is no query in the app that reads another user's rows.
  const result = await tryQuery(async () => {
    const rows = await db
      .select()
      .from(agreement)
      .where(eq(agreement.userId, session.user.id))
      // id breaks ties: rows inserted in the same batch share a timestamp, and
      // without a second key their order shuffles between renders.
      .orderBy(desc(agreement.createdAt), desc(agreement.id));

    // The table is built from Docusign, so whether that connection is usable
    // decides what the page can offer — and when it last ran is worth saying.
    const [docusignStatus, lastSyncedAt] = await Promise.all([
      getConnectionStatus(session.user.id),
      getLastSyncedAt(session.user.id),
    ]);

    return { rows, docusignStatus, lastSyncedAt };
  });
  if (result.status === "database-unavailable") return <DatabaseOffline />;
  const { rows, docusignStatus, lastSyncedAt } = result.data;
  const syncedAgo = formatTimeAgo(lastSyncedAt);

  // Neither an expired nor a voided agreement is worth anything to the business
  // today, so neither counts towards the value on the books.
  const active = rows.filter(
    (row) => row.status !== "expired" && row.status !== "voided",
  );
  const totalValue = active.reduce((sum, row) => sum + (row.valueCents ?? 0), 0);
  const currency = active.find((row) => row.valueCents !== null)?.currency ?? "USD";
  const mixedCurrencies = new Set(
    active.filter((row) => row.valueCents !== null).map((row) => row.currency),
  ).size > 1;

  const summary = [
    { label: "Agreements", value: String(rows.length) },
    {
      label: "Awaiting signature",
      value: String(rows.filter((row) => row.status === "out_for_signature").length),
    },
    {
      label: "Executed",
      value: String(rows.filter((row) => row.status === "executed").length),
    },
    {
      label: `Expiring in ${EXPIRING_SOON_DAYS} days`,
      value: String(
        rows.filter((row) => expiryTone(row.expiryDate, row.status) === "soon").length,
      ),
    },
    {
      label: "Active contract value",
      value: mixedCurrencies ? "Mixed" : formatMoney(totalValue, currency),
    },
  ];

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agreements</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Every contract you own, from first draft through to renewal.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <SyncButton docusignStatus={docusignStatus} />
          {syncedAgo && (
            <p className="text-muted-foreground text-xs">Imported {syncedAgo}</p>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 lg:grid-cols-5">
          {summary.map((tile) => (
            <div key={tile.label} className="bg-card px-4 py-3.5">
              <dt className="text-muted-foreground text-xs font-medium">
                {tile.label}
              </dt>
              <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
                {tile.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

        <AgreementsTable agreements={rows} docusignStatus={docusignStatus} />
      </div>
    </main>
  );
}
