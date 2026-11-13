import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Database access. App code must only use `tenantDb(hotelId)`.
 *
 * Tenant isolation has two independent layers:
 *  1. This module adds `hotelId` to every query's filter and to every created row.
 *  2. Postgres row-level security: each query runs in a transaction that sets
 *     `app.hotel_id`, and policies on every table only allow that hotel's rows
 *     to the `hotel_app` role (see the rls_and_grants migration).
 * A bug in either layer alone cannot leak another hotel's data.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createClient(connectionString: string | undefined) {
  if (!connectionString) throw new Error("Database URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// One pooled client per process (survives Next.js dev hot reloads).
const globalForDb = globalThis as unknown as { appDb?: PrismaClient };
function appDb(): PrismaClient {
  globalForDb.appDb ??= createClient(process.env.DATABASE_URL);
  return globalForDb.appDb;
}

// Operations whose args take a `where` filter.
const WHERE_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

type Args = { where?: object; data?: unknown; create?: object };

/** Layer 1: scope one operation's arguments to the hotel. Exported for tests. */
export function scopeArgs(model: string, operation: string, args: Args, hotelId: string): Args {
  const key = model === "Hotel" ? "id" : "hotelId";
  const scoped: Args = { ...args };
  if (WHERE_OPS.has(operation)) scoped.where = { ...args.where, [key]: hotelId };
  if (model !== "Hotel") {
    if (operation === "create") scoped.data = { ...(args.data as object), hotelId };
    if (operation === "upsert") scoped.create = { ...args.create, hotelId };
    if (operation === "createMany" || operation === "createManyAndReturn") {
      const rows = Array.isArray(args.data) ? args.data : [args.data];
      scoped.data = rows.map((row) => ({ ...(row as object), hotelId }));
    }
  }
  return scoped;
}

/** A Prisma client whose every query is confined to one hotel. */
export function tenantDb(hotelId: string) {
  if (!UUID_RE.test(hotelId)) throw new Error("tenantDb: invalid hotel id");
  const db = appDb();
  return db.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scoped = scopeArgs(model, operation, args as Args, hotelId);
          // Layer 2: set the RLS tenant for this transaction only.
          const [, result] = await db.$transaction([
            db.$executeRaw`SELECT set_config('app.hotel_id', ${hotelId}, TRUE)`,
            query(scoped as typeof args),
          ]);
          return result;
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;

/**
 * Resolves a guest token hash to its stay through the resolve_guest_stay()
 * database function — the only lookup allowed before the hotel is known.
 */
export async function resolveStayByTokenHash(
  tokenHash: string,
): Promise<{ stayId: string; hotelId: string } | null> {
  const rows = await appDb().$queryRaw<{ stay_id: string; hotel_id: string }[]>`
    SELECT stay_id, hotel_id FROM resolve_guest_stay(${tokenHash})`;
  const row = rows[0];
  return row ? { stayId: row.stay_id, hotelId: row.hotel_id } : null;
}
