import { cn } from "@/lib/utils";

/** The mark: a document with a check. Used in the nav, the login screen and empty states. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "bg-primary text-primary-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-md",
        className,
      )}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-[60%]"
      >
        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
        <path d="M18 21H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h8l5 5v12a1 1 0 0 1-1 1Z" />
        <path d="m9 14 2 2 4-4" />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Logo />
      {/* On narrow screens the mark carries the branding so the nav still fits. */}
      <span className="hidden text-[0.95rem] leading-none font-semibold tracking-tight sm:inline">
        Agreement Agent
      </span>
    </span>
  );
}
