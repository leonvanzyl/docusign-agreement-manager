import type { AgreementStatus, AgreementType } from "@/lib/db/schema";

export const AGREEMENT_TYPES: AgreementType[] = [
  "nda",
  "msa",
  "sow",
  "dpa",
  "order_form",
  "other",
];

export const AGREEMENT_STATUSES: AgreementStatus[] = [
  "draft",
  "in_review",
  "out_for_signature",
  "executed",
  "expired",
  "voided",
];

/** How many days before expiry a contract starts being flagged in the table. */
export const EXPIRING_SOON_DAYS = 30;

export function formatMoney(valueCents: number | null, currency: string) {
  if (valueCents === null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(valueCents / 100);
  } catch {
    // Unknown currency code — still show the number rather than blowing up.
    return `${currency} ${(valueCents / 100).toLocaleString("en-US")}`;
  }
}

/**
 * `date` columns come back as plain "YYYY-MM-DD" strings. Parsing them with
 * `new Date(string)` would drag them through the local timezone and can shift
 * the day, so the parts are read directly instead.
 */
function parseDateParts(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

export function formatDate(iso: string | null) {
  if (!iso) return "—";
  const parts = parseDateParts(iso);
  if (!parts) return iso;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(Date.UTC(parts.year, parts.month - 1, parts.day));
}

/** Whole days from today until `iso`. Negative once the date has passed. */
export function daysUntil(iso: string | null) {
  if (!iso) return null;
  const parts = parseDateParts(iso);
  if (!parts) return null;
  const target = Date.UTC(parts.year, parts.month - 1, parts.day);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

const RELATIVE = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/**
 * "3 minutes ago", for the last-import timestamp.
 *
 * Formatted on the server and passed down as a finished string. Working it out in
 * the browser instead would have the client and the server disagree about "now"
 * during hydration, which React reports as a mismatch.
 */
export function formatTimeAgo(at: Date | null): string | null {
  if (!at) return null;
  const elapsed = Date.now() - at.getTime();
  if (elapsed < 60_000) return "just now";

  for (const [unit, ms] of RELATIVE_UNITS) {
    if (elapsed >= ms) return RELATIVE.format(-Math.floor(elapsed / ms), unit);
  }
  return "just now";
}

export type ExpiryTone = "none" | "soon" | "past";

export function expiryTone(iso: string | null, status: AgreementStatus): ExpiryTone {
  // Already-expired records carry their own status badge; don't double up. A
  // voided agreement never took effect, so counting down to its expiry would be
  // announcing a renewal that is never coming.
  if (!iso || status === "expired" || status === "voided") return "none";
  const days = daysUntil(iso);
  if (days === null) return "none";
  if (days < 0) return "past";
  return days <= EXPIRING_SOON_DAYS ? "soon" : "none";
}

export function expiryNote(iso: string | null, status: AgreementStatus) {
  const tone = expiryTone(iso, status);
  if (tone === "none") return null;
  const days = daysUntil(iso);
  if (days === null) return null;
  if (tone === "past") {
    const overdue = Math.abs(days);
    return `Ended ${overdue} day${overdue === 1 ? "" : "s"} ago`;
  }
  if (days === 0) return "Expires today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}
