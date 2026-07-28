import "server-only";

import { getDocusignConfig, type DocusignConfig } from "./config";

/**
 * The Confidential Authorization Code Grant flow, and nothing else.
 *
 * The Docusign MCP server accepts tokens from this grant type only, which is why
 * the app holds a secret key and does the exchange server-side rather than using
 * a public/PKCE flow.
 *
 * Scope note: these are calls to Docusign's *authentication* service, not to the
 * eSignature or Navigator REST APIs. Obtaining and renewing the token is the whole
 * job here — actually using it to do Docusign work belongs to the MCP server.
 */

export type DocusignTokens = {
  accessToken: string;
  refreshToken: string;
  /** Absolute time, computed from the relative `expires_in` Docusign returns. */
  accessTokenExpiresAt: Date;
  scope: string;
};

/**
 * Builds the consent URL the user's browser is sent to.
 *
 * `state` is round-tripped by Docusign and checked against a cookie on the way
 * back — that pairing is what stops an attacker replaying their own authorization
 * code into a victim's session.
 */
export function buildAuthorizationUrl(state: string, config: DocusignConfig): string {
  const url = new URL(config.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes);
  url.searchParams.set("client_id", config.integrationKey);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Docusign authenticates the token endpoint with HTTP Basic, not a client_secret
 * body field: base64("<integration key>:<secret key>").
 */
function basicAuthHeader(config: DocusignConfig): string {
  const credentials = `${config.integrationKey}:${config.secretKey}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function requestToken(
  body: URLSearchParams,
  config: DocusignConfig,
): Promise<TokenResponse> {
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    // Token exchanges are per-user and single-use; caching one would be a bug.
    cache: "no-store",
  });

  // Docusign reports failures as JSON with an `error` field, but an infrastructure
  // error can still arrive as HTML — so the body is only parsed defensively.
  const raw = await response.text();
  let parsed: TokenResponse = {};
  try {
    parsed = raw ? (JSON.parse(raw) as TokenResponse) : {};
  } catch {
    parsed = {};
  }

  if (!response.ok || !parsed.access_token) {
    const detail =
      parsed.error_description ??
      parsed.error ??
      raw.slice(0, 200) ??
      `HTTP ${response.status}`;
    throw new Error(`Docusign token request failed: ${detail}`);
  }

  return parsed;
}

function toTokens(response: TokenResponse, config: DocusignConfig): DocusignTokens {
  if (!response.refresh_token) {
    throw new Error(
      "Docusign did not return a refresh token. Check that the integration key is set to Authorization Code Grant and that the `extended` scope is requested.",
    );
  }

  // Renew slightly early rather than exactly on the boundary; a token that expires
  // mid-request is indistinguishable from a revoked one at the call site.
  const expiresInSeconds = response.expires_in ?? 3600;

  return {
    accessToken: response.access_token!,
    refreshToken: response.refresh_token,
    accessTokenExpiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    // Docusign echoes the granted scope; fall back to what we asked for when it doesn't.
    scope: response.scope ?? config.scopes,
  };
}

/**
 * Step 2 of the flow: trade the one-time code for tokens.
 *
 * The code is valid for two minutes, so this runs inline in the callback rather
 * than being queued behind anything slow.
 */
export async function exchangeCodeForTokens(code: string): Promise<DocusignTokens> {
  const config = getDocusignConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    // Not required by Docusign's token endpoint, but sending it keeps the exchange
    // consistent with the authorization request and is harmless if ignored.
    redirect_uri: config.redirectUri,
  });

  return toTokens(await requestToken(body, config), config);
}

/**
 * Trades a refresh token for a fresh access token.
 *
 * Docusign issues a *new* refresh token each time, so the caller must persist the
 * whole result — reusing the old refresh token after this succeeds will fail.
 */
export async function refreshTokens(refreshToken: string): Promise<DocusignTokens> {
  const config = getDocusignConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  return toTokens(await requestToken(body, config), config);
}
