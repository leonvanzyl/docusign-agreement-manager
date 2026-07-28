import { redirect } from "next/navigation";

import { Logo } from "@/components/brand";
import { DatabaseOffline } from "@/components/database-offline";
import { tryGetSession } from "@/lib/session";

const HIGHLIGHTS = [
  "One register for every NDA, MSA, SOW, DPA and order form.",
  "Status from first draft through to fully executed.",
  "Renewal and expiry dates surfaced before they bite.",
];

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Already signed in? The login screen is not the place to be.
  const result = await tryGetSession();
  if (result.status === "database-unavailable") return <DatabaseOffline />;
  if (result.session) redirect("/agreements");

  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Branded panel — hidden on small screens, where the form is the whole job. */}
      <div className="bg-primary text-primary-foreground relative hidden flex-col justify-between p-10 lg:flex xl:p-14">
        <div className="flex items-center gap-3">
          <Logo className="bg-primary-foreground/12 text-primary-foreground" />
          <span className="text-[0.95rem] font-semibold tracking-tight">
            Agreement Agent
          </span>
        </div>

        <div className="max-w-md">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance xl:text-4xl">
            Every contract the team owns, in one place.
          </h1>
          <ul className="mt-8 space-y-3.5">
            {HIGHLIGHTS.map((line) => (
              <li key={line} className="flex gap-3 text-sm/relaxed opacity-90">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                >
                  <path d="m5 12 4.5 4.5L19 7" />
                </svg>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs opacity-70">Internal use only.</p>
      </div>

      <div className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
