import "server-only";

/**
 * Docusign OAuth configuration, read from the environment in exactly one place.
 *
 * This is a *separate* OAuth client from Better Auth. Better Auth answers "who is
 * signed in to this app?"; Docusign answers "which Docusign account may this app
 * act on behalf of?". They share no routes, no tables, and no secrets.
 */

export type DocusignEnvironment = "demo" | "production";

/**
 * Docusign runs two entirely separate worlds. Tokens minted in one are rejected by
 * the other, so the account server and the MCP server are always chosen together.
 */
const HOSTS = {
  demo: { account: "https://account-d.docusign.com", mcp: "https://mcp-d.docusign.com/mcp" },
  production: { account: "https://account.docusign.com", mcp: "https://mcp.docusign.com/mcp" },
} as const satisfies Record<DocusignEnvironment, { account: string; mcp: string }>;

/**
 * Scopes the MCP server cannot work without, merged into whatever is configured.
 *
 * `aow_manage` and `adm_store_unified_repo_read` are IAM scopes: requesting them is
 * what makes Docusign mint a JWT-format access token, and a JWT is what the MCP
 * server accepts. A token carrying only `signature` authenticates fine against the
 * eSignature REST API and is still refused by MCP, which is a confusing failure to
 * debug — so these are enforced here rather than left to the environment.
 */
const REQUIRED_SCOPES = ["signature", "aow_manage", "adm_store_unified_repo_read"];

/**
 * Added on top of the required set when DOCUSIGN_SCOPES is unset. `extended` buys a
 * renewable 30-day refresh token; `openid` identifies the user.
 */
const DEFAULT_EXTRA_SCOPES = ["extended", "openid"];

/** Splits a space-separated scope string, tolerating extra whitespace. */
export function parseScopes(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

/** Union that preserves order and drops duplicates, so consent asks for each scope once. */
function mergeScopes(...groups: string[][]): string[] {
  return [...new Set(groups.flat())];
}

/**
 * Which of the required scopes a stored connection is missing.
 *
 * A connection made before the scope list changed still looks valid — it has live
 * tokens — but MCP will reject it. Comparing against the granted scope recorded at
 * connect time is what turns that silent failure into a prompt to reconnect.
 */
export function missingRequiredScopes(grantedScope: string): string[] {
  const granted = new Set(parseScopes(grantedScope));
  return REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
}

export type DocusignConfig = {
  integrationKey: string;
  secretKey: string;
  redirectUri: string;
  scopes: string;
  environment: DocusignEnvironment;
  /** Where consent is requested. */
  authorizationUrl: string;
  /** Where codes and refresh tokens are exchanged for access tokens. */
  tokenUrl: string;
  /**
   * The MCP endpoint these tokens authorize. Nothing here calls it — it is resolved
   * alongside the account host so the two can never drift out of sync.
   */
  mcpUrl: string;
};

function readEnvironment(): DocusignEnvironment {
  const value = process.env.DOCUSIGN_ENVIRONMENT?.trim().toLowerCase();
  if (!value || value === "demo") return "demo";
  if (value === "production") return "production";
  throw new Error(
    `DOCUSIGN_ENVIRONMENT must be "demo" or "production" (got "${value}").`,
  );
}

/**
 * Resolves configuration, or explains precisely what is missing.
 *
 * Called at request time rather than at module load: a missing key should surface
 * as a handled "Docusign isn't configured" message on the one route that needs it,
 * not as a crash that takes the whole app down at boot.
 */
export function getDocusignConfig(): DocusignConfig {
  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY?.trim();
  const secretKey = process.env.DOCUSIGN_SECRET_KEY?.trim();

  const missing = [
    !integrationKey && "DOCUSIGN_INTEGRATION_KEY",
    !secretKey && "DOCUSIGN_SECRET_KEY",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Docusign is not configured. Set ${missing.join(" and ")} in .env — see the Docusign section of that file.`,
    );
  }

  const environment = readEnvironment();
  const hosts = HOSTS[environment];

  // Docusign compares the redirect URI as an exact string, so it is configured
  // rather than reconstructed per-request from whatever Host header showed up.
  const redirectUri =
    process.env.DOCUSIGN_REDIRECT_URI?.trim() ||
    `${(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/docusign/callback`;

  const configured = process.env.DOCUSIGN_SCOPES?.trim();
  // The required scopes are unioned in rather than validated: dropping one from
  // .env should not be able to produce a token the MCP server silently refuses.
  const scopes = mergeScopes(
    REQUIRED_SCOPES,
    configured ? parseScopes(configured) : DEFAULT_EXTRA_SCOPES,
  );

  return {
    integrationKey: integrationKey!,
    secretKey: secretKey!,
    redirectUri,
    scopes: scopes.join(" "),
    environment,
    authorizationUrl: `${hosts.account}/oauth/auth`,
    tokenUrl: `${hosts.account}/oauth/token`,
    mcpUrl: hosts.mcp,
  };
}

/** True when the integration key and secret are present, without throwing. */
export function isDocusignConfigured(): boolean {
  return Boolean(
    process.env.DOCUSIGN_INTEGRATION_KEY?.trim() && process.env.DOCUSIGN_SECRET_KEY?.trim(),
  );
}
