import { NextResponse, type NextRequest } from "next/server";

import { saveConnection } from "@/lib/docusign/connection";
import { exchangeCodeForTokens } from "@/lib/docusign/oauth";
import { nonceMatches, readState, STATE_COOKIE } from "@/lib/docusign/state";
import { getSession } from "@/lib/session";

/**
 * Where Docusign sends the browser after the user accepts or declines consent.
 *
 * Standalone by design: this is not a Better Auth social provider and does not live
 * under /api/auth. Better Auth owns app login; this owns a resource connection that
 * a logged-in user adds on top. The only thing the two share is the question "who
 * is signed in?", which is read from the session below.
 *
 * The redirect URI registered on the Docusign integration key must point here
 * exactly: <origin>/api/docusign/callback
 */

const DEFAULT_RETURN_TO = "/agreements";

function redirectWith(
  request: NextRequest,
  returnTo: string,
  params: Record<string, string>,
) {
  const destination = new URL(returnTo, request.nextUrl.origin);
  for (const [key, value] of Object.entries(params)) {
    destination.searchParams.set(key, value);
  }

  const response = NextResponse.redirect(destination);
  // The state cookie is single-use whatever the outcome — clearing it on every
  // path stops a stale nonce being replayed.
  response.cookies.delete(STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = readState(request.cookies.get(STATE_COOKIE)?.value);
  const returnTo = state?.returnTo ?? DEFAULT_RETURN_TO;

  // Tokens are stored against the logged-in user, so the session is what decides
  // whose row this is — never anything carried in the callback URL.
  const session = await getSession();
  if (!session) {
    return redirectWith(request, "/sign-in", {});
  }

  // The user declined, or Docusign rejected the request outright.
  const oauthError = params.get("error");
  if (oauthError) {
    return redirectWith(request, returnTo, {
      docusign: "error",
      message: params.get("error_description") ?? oauthError,
    });
  }

  // Reject before spending the code: an unmatched state means this callback did
  // not originate from a consent flow this browser started.
  if (!state || !nonceMatches(state.nonce, params.get("state"))) {
    return redirectWith(request, returnTo, {
      docusign: "error",
      message: "That Docusign connection request expired or was invalid. Please try again.",
    });
  }

  const code = params.get("code");
  if (!code) {
    return redirectWith(request, returnTo, {
      docusign: "error",
      message: "Docusign did not return an authorization code.",
    });
  }

  try {
    // Authorization codes are valid for two minutes, so the exchange happens here
    // and now. The resulting tokens are only ever used to authorize the MCP
    // connection — this app makes no Docusign REST calls of its own.
    const tokens = await exchangeCodeForTokens(code);
    await saveConnection(session.user.id, tokens);
  } catch (error) {
    return redirectWith(request, returnTo, {
      docusign: "error",
      message:
        error instanceof Error ? error.message : "Could not complete the Docusign connection.",
    });
  }

  return redirectWith(request, returnTo, { docusign: "connected" });
}
