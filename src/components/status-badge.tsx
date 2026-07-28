import { AGREEMENT_STATUS_LABELS, type AgreementStatus } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

/**
 * Colour comes from the `.status-*` classes in globals.css, keyed by the database
 * enum value — so the palette stays in one file rather than spread through components.
 */
export function StatusBadge({
  status,
  className,
}: {
  status: AgreementStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        `status-${status}`,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {AGREEMENT_STATUS_LABELS[status]}
    </span>
  );
}
