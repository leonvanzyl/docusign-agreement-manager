"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Logo } from "@/components/brand";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { expiryNote, expiryTone, formatDate, formatMoney } from "@/lib/agreements";
import {
  AGREEMENT_SOURCE_LABELS,
  AGREEMENT_STATUS_LABELS,
  AGREEMENT_TYPE_LABELS,
  type Agreement,
} from "@/lib/db/schema";
import type { DocusignConnectionStatus } from "@/lib/docusign/connection";
import { cn } from "@/lib/utils";

import { deleteAgreement, loadSampleAgreements } from "./actions";
import { SyncButton } from "./sync-button";

const STATUS_FILTER_ITEMS = {
  all: "All statuses",
  ...AGREEMENT_STATUS_LABELS,
};

export function AgreementsTable({
  agreements,
  docusignStatus,
}: {
  agreements: Agreement[];
  docusignStatus: DocusignConnectionStatus;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [pendingDelete, setPendingDelete] = useState<Agreement | undefined>();
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return agreements.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!needle) return true;
      return [row.title, row.counterparty, row.owner ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [agreements, query, statusFilter]);

  function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    startTransition(async () => {
      const result = await deleteAgreement(target.id);
      if (result.ok) {
        toast.success(`Deleted “${target.title}”`);
        setPendingDelete(undefined);
      } else {
        toast.error(result.error);
      }
    });
  }

  function loadSamples() {
    startTransition(async () => {
      const result = await loadSampleAgreements();
      if (result.ok) toast.success("Sample agreements added");
      else toast.error(result.error);
    });
  }

  // Nothing at all in the register yet — a different situation from "no matches".
  if (agreements.length === 0) {
    return (
      <EmptyRegister
        onLoadSamples={loadSamples}
        busy={isPending}
        docusignStatus={docusignStatus}
      />
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search title, counterparty or owner…"
          className="sm:max-w-xs"
          aria-label="Search agreements"
        />

        <Select
          items={STATUS_FILTER_ITEMS}
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(String(value))}
        >
          <SelectTrigger className="h-9 w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(STATUS_FILTER_ITEMS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card mt-4 overflow-hidden rounded-lg border">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="min-w-[16rem]">Agreement</TableHead>
                <TableHead className="hidden md:table-cell">Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Value</TableHead>
                <TableHead className="hidden xl:table-cell">Owner</TableHead>
                <TableHead className="hidden sm:table-cell">Expires</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>

            <TableBody>
              {filtered.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="py-14 text-center">
                    <p className="text-sm font-medium">No matching agreements</p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      Try a different search term or clear the status filter.
                    </p>
                  </TableCell>
                </TableRow>
              )}

              {filtered.map((row) => {
                const tone = expiryTone(row.expiryDate, row.status);
                const note = expiryNote(row.expiryDate, row.status);

                return (
                  <TableRow key={row.id}>
                    <TableCell className="py-3">
                      <div className="font-medium">{row.title}</div>
                      <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1 text-xs">
                        <span>{row.counterparty}</span>
                        <span className="md:hidden">
                          {" · "}
                          {AGREEMENT_TYPE_LABELS[row.type]}
                        </span>
                        <SourceChip source={row.source} />
                      </div>
                    </TableCell>

                    <TableCell className="text-muted-foreground hidden text-sm md:table-cell">
                      {AGREEMENT_TYPE_LABELS[row.type]}
                    </TableCell>

                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>

                    <TableCell className="hidden text-right font-medium tabular-nums lg:table-cell">
                      {formatMoney(row.valueCents, row.currency)}
                    </TableCell>

                    <TableCell className="text-muted-foreground hidden text-sm xl:table-cell">
                      {row.owner ?? "—"}
                    </TableCell>

                    <TableCell className="hidden text-sm sm:table-cell">
                      <span className="tabular-nums">{formatDate(row.expiryDate)}</span>
                      {note && (
                        <span
                          className={cn(
                            "mt-0.5 block text-xs",
                            tone === "past"
                              ? "text-destructive"
                              : "text-muted-foreground",
                          )}
                        >
                          {note}
                        </span>
                      )}
                    </TableCell>

                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Actions for ${row.title}`}
                            />
                          }
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            className="size-4"
                            aria-hidden="true"
                          >
                            <circle cx="12" cy="5" r="1.6" />
                            <circle cx="12" cy="12" r="1.6" />
                            <circle cx="12" cy="19" r="1.6" />
                          </svg>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setPendingDelete(row)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <p className="text-muted-foreground mt-3 text-xs">
        Showing {filtered.length} of {agreements.length}{" "}
        {agreements.length === 1 ? "agreement" : "agreements"}
      </p>

      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this agreement?</DialogTitle>
            <DialogDescription>
              “{pendingDelete?.title}” will be removed from your register. This can&apos;t
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDelete(undefined)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={isPending}>
              {isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Which Docusign product a row was built from.
 *
 * Not decoration. An eSignature row is an envelope still in flight — it has no
 * value and no term, because an envelope does not carry them — while an Agreement
 * Manager row is the complete record. The chip is what explains the empty cells
 * beside it rather than leaving them looking like missing data.
 */
function SourceChip({ source }: { source: Agreement["source"] }) {
  if (source === "manual") return null;

  return (
    <span className="text-muted-foreground/80 ml-0.5 rounded border px-1.5 py-px text-[10px] font-medium tracking-wide uppercase">
      {AGREEMENT_SOURCE_LABELS[source]}
    </span>
  );
}

function EmptyRegister({
  onLoadSamples,
  busy,
  docusignStatus,
}: {
  onLoadSamples: () => void;
  busy: boolean;
  docusignStatus: DocusignConnectionStatus;
}) {
  const connected = docusignStatus === "connected";

  return (
    <div className="bg-card rounded-lg border px-6 py-16 text-center">
      <Logo className="mx-auto size-10" />
      <h2 className="mt-5 text-lg font-semibold tracking-tight">
        Your register is empty
      </h2>
      <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm/relaxed">
        Agreements are the contracts your team owns — NDAs, MSAs, statements of work,
        DPAs and order forms. Import them from Docusign and they appear here the moment
        they are sent, with their status and renewal dates tracked.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <SyncButton
          docusignStatus={docusignStatus}
          variant="default"
          label="Import from Docusign"
        />
        <Button variant="outline" size="sm" onClick={onLoadSamples} disabled={busy}>
          {busy ? "Adding…" : "Load sample agreements"}
        </Button>
      </div>
      <p className="text-muted-foreground mx-auto mt-4 max-w-md text-xs/relaxed">
        {connected
          ? "Importing reads your envelopes and your Agreement Manager records, and merges the two."
          : "Connect Docusign from the header to import. Samples are ordinary records added to your own register — delete them like any other."}
      </p>
    </div>
  );
}
