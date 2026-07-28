import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { docusignConnection, type DocusignConnection } from "@/lib/db/schema";

import {
  getDocusignConfig,
  isDocusignConfigured,
  missingRequiredScopes,
} from "./config";
import { refreshTokens, type DocusignTokens } from "./oauth";

/**
 * Reads and writes a user's Docusign tokens.
 *
 * Every function takes `userId` from the caller's *session* — never from a request
 * body or query string. That is what makes "store the tokens against the logged-in
 * user" actually hold.
 */

/** Refresh this far ahead of expiry so a token can't lapse mid-request. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export async function getConnection(userId: string): Promise<DocusignConnection | null> {
  const [row] = await db
    .select()
    .from(docusignConnection)
    .where(eq(docusignConnection.userId, userId))
    .limit(1);

  return row ?? null;
}

/**
 * Persists a freshly completed consent flow.
 *
 * An upsert on `userId`: reconnecting replaces the old tokens rather than leaving a
 * second, stale row behind.
 */
export async function saveConnection(
  userId: string,
  tokens: DocusignTokens,
): Promise<void> {
  const { environment } = getDocusignConfig();

  const values = {
    userId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    scope: tokens.scope,
    environment,
  };

  await db
    .insert(docusignConnection)
    .values(values)
    .onConflictDoUpdate({
      target: docusignConnection.userId,
      set: {
        accessToken: values.accessToken,
        refreshToken: values.refreshToken,
        accessTokenExpiresAt: values.accessTokenExpiresAt,
        scope: values.scope,
        environment: values.environment,
        connectedAt: new Date(),
      },
    });
}

export async function deleteConnection(userId: string): Promise<void> {
  await db.delete(docusignConnection).where(eq(docusignConnection.userId, userId));
}

/**
 * "connected" only when the stored grant would actually satisfy the MCP server.
 *
 * A row can hold perfectly live tokens and still be unusable — because it was
 * granted before a scope was added, or against the other Docusign environment.
 * Both fail at MCP with errors that point nowhere near the real cause, so they are
 * surfaced up front as "reconnect" instead.
 */
export type DocusignConnectionStatus = "disconnected" | "connected" | "needs-reconnect";

export async function getConnectionStatus(
  userId: string,
): Promise<DocusignConnectionStatus> {
  const connection = await getConnection(userId);
  if (!connection) return "disconnected";

  if (missingRequiredScopes(connection.scope).length > 0) return "needs-reconnect";

  // Guarded, because reading the config throws when Docusign isn't set up at all.
  if (isDocusignConfigured() && connection.environment !== getDocusignConfig().environment) {
    return "needs-reconnect";
  }

  return "connected";
}

/**
 * The accessor the MCP wiring will use: hands back a token that is valid *now*,
 * transparently refreshing one that is expired or about to be.
 *
 * Returns null rather than throwing when the user simply hasn't connected, or when
 * their refresh token has died — both are "ask the user to connect again", not
 * exceptional conditions. Docusign refresh tokens last ~30 days, so a user who
 * leaves the app alone for a month lands here.
 */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const connection = await getConnection(userId);
  if (!connection) return null;

  // Refusing here is kinder than handing MCP a token it will reject: the caller
  // gets the same "not connected" path that prompts the user to reconnect.
  if (missingRequiredScopes(connection.scope).length > 0) return null;

  const stillFresh =
    connection.accessTokenExpiresAt.getTime() - REFRESH_SKEW_MS > Date.now();
  if (stillFresh) return connection.accessToken;

  try {
    // Docusign rotates the refresh token on every use, so the whole result is
    // written back — keeping the old one would break the *next* refresh.
    const tokens = await refreshTokens(connection.refreshToken);
    await saveConnection(userId, tokens);
    return tokens.accessToken;
  } catch {
    // The stored grant is no longer usable. Clearing it means the UI shows
    // "Connect Docusign" again instead of silently failing on every request.
    await deleteConnection(userId);
    return null;
  }
}
