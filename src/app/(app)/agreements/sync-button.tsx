"use client";

import { RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { DocusignConnectionStatus } from "@/lib/docusign/connection";
import { cn } from "@/lib/utils";

import { syncAgreements } from "./actions";

/**
 * Pulls the register in from Docusign on demand.
 *
 * The same import runs on its own after the agent sends something, so this is the
 * manual path — for a signature that landed while nobody was looking, or an
 * envelope somebody sent from Docusign directly.
 */
export function SyncButton({
  docusignStatus,
  variant = "outline",
  label = "Sync with Docusign",
  className,
}: {
  docusignStatus: DocusignConnectionStatus;
  variant?: "default" | "outline";
  label?: string;
  className?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const connected = docusignStatus === "connected";

  function run() {
    startTransition(async () => {
      const result = await syncAgreements();

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      // Worth spelling out: an import that quietly changes nothing is
      // indistinguishable from one that failed.
      const parts = [
        result.created > 0 && `${result.created} new`,
        result.removed > 0 && `${result.removed} removed`,
      ].filter(Boolean);

      toast.success(
        parts.length > 0
          ? `Agreements updated — ${parts.join(", ")}`
          : result.total > 0
            ? "Agreements are already up to date"
            : "Docusign has no agreements to import yet",
      );
    });
  }

  return (
    <Button
      variant={variant}
      size="sm"
      onClick={run}
      disabled={!connected || isPending}
      className={className}
      // A disabled button with no explanation reads as broken.
      title={connected ? undefined : "Connect your Docusign account first"}
    >
      <RefreshCw
        className={cn("size-3.5", isPending && "animate-spin")}
        aria-hidden="true"
      />
      {isPending ? "Syncing…" : label}
    </Button>
  );
}
