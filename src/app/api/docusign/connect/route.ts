import { NextResponse, type NextRequest } from "next/server";

import { getDocusignConfig } from "@/lib/docusign/config";
import { buildAuthorizationUrl } from "@/lib/docusign/oauth";
import {
  createState,
  sanitizeReturnTo,
  STATE_COOKIE,
  STATE_COOKIE_OPTIONS,
} from "@/lib/docusign/state";
import { getSession } from "@/lib/session";

/**
 * Starts the Docusign consent flow.
 *
 * A route handler rather than a link the browser builds, because the authorization
 * URL is assembled from server-side configuration and has to be paired with a state
 * cookie set on the very same response.
 */
export async function GET(request: NextRequest) {
  const returnTo = sanitizeReturnTo(
    request.nextUrl.searchParams.get("returnTo"),
    "/agreements",
  );

  // Docusign tokens are stored against a user, so there must be a user. This is
  // the app's own session — Better Auth — which is a separate concern from the
  // Docusign grant being requested.
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(new URL("/sign-in", request.nextUrl.origin));
  }

  let authorizationUrl: string;
  try {
    const config = getDocusignConfig();
    const { nonce, cookieValue } = createState(returnTo);
    authorizationUrl = buildAuthorizationUrl(nonce, config);

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(STATE_COOKIE, cookieValue, STATE_COOKIE_OPTIONS);
    return response;
  } catch (error) {
    // Almost always a missing integration key or secret. Send the user back with a
    // readable reason instead of a 500 they can do nothing with.
    const destination = new URL(returnTo, request.nextUrl.origin);
    destination.searchParams.set("docusign", "error");
    destination.searchParams.set(
      "message",
      error instanceof Error ? error.message : "Could not start the Docusign connection.",
    );
    return NextResponse.redirect(destination);
  }
}
