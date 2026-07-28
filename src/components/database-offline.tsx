import { Logo } from "@/components/brand";

/**
 * Shown instead of crashing when Postgres isn't reachable — almost always because
 * the local container isn't running yet.
 */
export function DatabaseOffline() {
  return (
    <div className="flex min-h-svh items-center justify-center px-6 py-16">
      <div className="bg-card w-full max-w-md rounded-lg border p-8 text-center">
        <Logo className="mx-auto size-10" />
        <h1 className="mt-5 text-lg font-semibold tracking-tight">
          Can&apos;t reach the database
        </h1>
        <p className="text-muted-foreground mt-2 text-sm/relaxed">
          Agreement Agent stores everything in Postgres, and it isn&apos;t responding.
          If you&apos;re running this locally, start it and reload the page:
        </p>
        <pre className="bg-muted text-foreground mt-4 rounded-md px-3 py-2 text-left font-mono text-xs">
          pnpm db:up
        </pre>
        <p className="text-muted-foreground mt-4 text-xs">
          Already running? Check that <code className="font-mono">POSTGRES_URL</code> in{" "}
          <code className="font-mono">.env</code> points at it.
        </p>
      </div>
    </div>
  );
}
