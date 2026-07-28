"use client";

import { CheckCircle2, Link2, Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { disconnectDocusign } from "@/lib/docusign/actions";
import type { DocusignConnectionStatus } from "@/lib/docusign/connection";

/**
 * The entry point to the Docusign consent flow, plus the connected-state readout.
 *
 * Connecting is a full-page navigation to /api/docusign/connect rather than a fetch:
 * the flow ends up on Docusign's own consent screen, which cannot be done from a
 * background request.
 */

function ConnectButton({ needsReconnect }: { needsReconnect: boolean }) {
  const pathname = usePathname();

  // Come back to whichever screen the user set off from.
  const href = `/api/docusign/connect?returnTo=${encodeURIComponent(pathname)}`;

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-1.5"
      // A real navigation, not a fetch — the flow ends on Docusign's consent page.
      // `nativeButton={false}` tells Base UI the rendered element is an <a>, not a <button>.
      nativeButton={false}
      render={<a href={href} />}
      // An existing-but-unusable grant is the case worth explaining, since the row
      // looks connected from the outside.
      title={
        needsReconnect
          ? "Your Docusign connection is missing a scope the MCP server needs. Reconnect to grant it."
          : undefined
      }
    >
      <Link2 className="size-3.5" aria-hidden="true" />
      <span className="hidden sm:inline">
        {needsReconnect ? "Reconnect Docusign" : "Connect Docusign"}
      </span>
      <span className="sm:hidden">Docusign</span>
    </Button>
  );
}

function ConnectedBadge() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleDisconnect() {
    setPending(true);
    try {
      await disconnectDocusign();
      toast.success("Docusign disconnected.");
      router.refresh();
    } catch {
      toast.error("Could not disconnect Docusign.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground hidden items-center gap-1.5 text-xs font-medium sm:inline-flex">
        <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-500" aria-hidden="true" />
        Docusign connected
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground h-8 px-2 text-xs"
        onClick={handleDisconnect}
        disabled={pending}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : "Disconnect"}
      </Button>
    </div>
  );
}

/**
 * Turns the callback's `?docusign=` result into a toast, then strips it from the
 * URL so a refresh doesn't replay the message.
 *
 * Split out and suspended on its own because `useSearchParams` opts its whole
 * subtree into client-side rendering.
 */
function CallbackToast() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // React may run effects twice in development; the toast should still appear once.
  const handled = useRef<string | null>(null);

  const status = searchParams.get("docusign");
  const message = searchParams.get("message");

  useEffect(() => {
    if (!status) return;

    const key = `${status}:${message ?? ""}`;
    if (handled.current === key) return;
    handled.current = key;

    if (status === "connected") {
      toast.success("Docusign connected.");
    } else {
      toast.error(message ?? "Could not connect Docusign.");
    }

    const remaining = new URLSearchParams(searchParams);
    remaining.delete("docusign");
    remaining.delete("message");
    const query = remaining.toString();

    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    router.refresh();
  }, [status, message, pathname, router, searchParams]);

  return null;
}

export function DocusignConnection({ status }: { status: DocusignConnectionStatus }) {
  return (
    <>
      <Suspense fallback={null}>
        <CallbackToast />
      </Suspense>
      {status === "connected" ? (
        <ConnectedBadge />
      ) : (
        <ConnectButton needsReconnect={status === "needs-reconnect"} />
      )}
    </>
  );
}
