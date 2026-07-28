import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

export const db = drizzle(pool, { schema });

const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ECONNRESET",
  "57P03", // Postgres: the server is starting up and not yet accepting connections
]);

const CONNECTION_MESSAGE =
  /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|connection terminated|could not connect|connect ECONN/i;

/**
 * True when an error means "the database isn't reachable" rather than "the query
 * was wrong". Lets the app show a friendly notice when someone forgets `pnpm db:up`
 * instead of a raw stack trace, without paying for a health check on every request.
 *
 * The real cause is usually buried: Drizzle wraps it, and `pg` raises an
 * AggregateError holding one failure per resolved address (IPv4 and IPv6), so
 * both `cause` and `errors` have to be walked.
 */
export function isDatabaseConnectionError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 6) return false;

  const candidate = error as {
    code?: unknown;
    message?: unknown;
    cause?: unknown;
    errors?: unknown;
    body?: { code?: unknown };
  };

  if (typeof candidate.code === "string" && CONNECTION_ERROR_CODES.has(candidate.code)) {
    return true;
  }

  if (typeof candidate.message === "string" && CONNECTION_MESSAGE.test(candidate.message)) {
    return true;
  }

  // Better Auth discards the underlying driver error and rethrows its own APIError.
  // Sessions live in Postgres and nowhere else, so a failed session read means the
  // database is unreachable.
  if (candidate.body?.code === "FAILED_TO_GET_SESSION") return true;

  if (
    Array.isArray(candidate.errors) &&
    candidate.errors.some((nested) => isDatabaseConnectionError(nested, depth + 1))
  ) {
    return true;
  }

  return isDatabaseConnectionError(candidate.cause, depth + 1);
}

/**
 * Runs a query, separating "the database is down" from a genuine failure so
 * pages can render a friendly notice instead of a 500.
 */
export async function tryQuery<T>(
  run: () => Promise<T>,
): Promise<{ status: "ok"; data: T } | { status: "database-unavailable" }> {
  try {
    return { status: "ok", data: await run() };
  } catch (error) {
    if (isDatabaseConnectionError(error)) return { status: "database-unavailable" };
    throw error;
  }
}
