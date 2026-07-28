"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp } from "@/lib/auth-client";

type Mode = "sign-in" | "sign-up";

const COPY = {
  "sign-in": {
    title: "Sign in",
    subtitle: "Access your contract register.",
    action: "Sign in",
    pending: "Signing in…",
    switchPrompt: "Need an account?",
    switchAction: "Create one",
    switchHref: "/sign-up",
  },
  "sign-up": {
    title: "Create an account",
    subtitle: "Set up your access to Agreement Agent.",
    action: "Create account",
    pending: "Creating account…",
    switchPrompt: "Already have an account?",
    switchAction: "Sign in",
    switchHref: "/sign-in",
  },
} as const;

export function AuthForm({ mode }: { mode: Mode }) {
  const copy = COPY[mode];
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "");

    const result =
      mode === "sign-up"
        ? await signUp.email({ name, email, password })
        : await signIn.email({ email, password });

    if (result.error) {
      setError(result.error.message ?? "Something went wrong. Please try again.");
      setPending(false);
      return;
    }

    // refresh() so the server components re-read the new session cookie.
    router.push("/agreements");
    router.refresh();
  }

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-semibold tracking-tight">{copy.title}</h2>
        <p className="text-muted-foreground mt-1.5 text-sm">{copy.subtitle}</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        {mode === "sign-up" && (
          <div className="space-y-2">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              required
              placeholder="Jordan Reyes"
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            required
            minLength={8}
            placeholder={mode === "sign-up" ? "At least 8 characters" : "••••••••"}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="border-destructive/30 bg-destructive/8 text-destructive rounded-md border px-3 py-2 text-sm"
          >
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? copy.pending : copy.action}
        </Button>
      </form>

      <p className="text-muted-foreground mt-6 text-center text-sm">
        {copy.switchPrompt}{" "}
        <Link
          href={copy.switchHref}
          className="text-foreground font-medium underline-offset-4 hover:underline"
        >
          {copy.switchAction}
        </Link>
      </p>
    </div>
  );
}
