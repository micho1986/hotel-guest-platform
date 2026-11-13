import type { Prisma } from "@/generated/prisma/client";
import type { TenantDb } from "@/server/db";

/** Records who did what. The app can insert audit rows but never edit or delete them. */
export async function audit(
  db: TenantDb,
  hotelId: string,
  entry: { actorId: string | null; action: string; entity: string; entityId?: string | null; diff?: Prisma.InputJsonValue; ip?: string | null },
): Promise<void> {
  await db.auditLog.create({
    data: {
      hotelId,
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      diff: entry.diff,
      ip: entry.ip ?? null,
    },
  });
}
