import type { PoolConfig } from "pg";

/**
 * Every Postgres connection runs its session in UTC.
 *
 * Prisma's pg adapter sends a Date as UTC wall-clock text with no offset, and reads timestamptz by
 * relabelling the session's offset as +00:00. Both are correct only in a UTC session. In any other
 * session time zone (a Mac or server set to Asia/Dubai, say), app-written times and database-generated
 * times (now(), column defaults) disagree by the offset, and alert windows compare the two.
 *
 * Not "server-only": the seed, the platform script and the tests use it too.
 */
export const UTC_SESSION_OPTIONS = "-c TimeZone=UTC";

export function pgConfig(connectionString: string): PoolConfig {
  return { connectionString, options: UTC_SESSION_OPTIONS };
}
