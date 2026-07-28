import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * CSRF protection for the consent round trip.
 *
 * The flow leaves the app entirely and comes back as a plain GET, so the callback
 * has to prove the code it just received belongs to the browser that started the
 * flow. A random nonce is planted in an httpOnly cookie and echoed through
 * Docusign's `state` parameter; the callback only proceeds when the two match.
 *
 * Without this, anyone could feed their own authorization code to a signed-in
 * user's callback and quietly attach *their* Docusign account to that user.
 */

export const STATE_COOKIE = "docusign_oauth_state";

/** The consent detour is a single page load; ten minutes is generous for it. */
const STATE_TTL_SECONDS = 10 * 60;

type StatePayload = { nonce: string; returnTo: string };

export const STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  // `lax` rather than `strict`: the cookie must survive Docusign's top-level
  // redirect back into the app, which `strict` would withhold.
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: STATE_TTL_SECONDS,
} as const;

/**
 * Only same-origin, path-only destinations are allowed back. Anything else —
 * absolute URLs, protocol-relative `//evil.com`, backslash tricks — collapses to
 * the default, so the callback can't be used as an open redirect.
 */
export function sanitizeReturnTo(value: string | null, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}

export function createState(returnTo: string): { nonce: string; cookieValue: string } {
  const nonce = randomBytes(32).toString("base64url");
  const payload: StatePayload = { nonce, returnTo };
  return {
    nonce,
    cookieValue: Buffer.from(JSON.stringify(payload)).toString("base64url"),
  };
}

export function readState(cookieValue: string | undefined): StatePayload | null {
  if (!cookieValue) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cookieValue, "base64url").toString("utf8"),
    ) as StatePayload;

    if (typeof parsed?.nonce !== "string" || typeof parsed?.returnTo !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Compared in constant time — the nonce is a secret, so it is not leaked by timing. */
export function nonceMatches(expected: string, received: string | null): boolean {
  if (!received) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
