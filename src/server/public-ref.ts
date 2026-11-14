import "server-only";
import type { TenantDb } from "@/server/db";

/**
 * The next public reference for a department, e.g. HK-1001, HK-1002.
 * Counted per hotel and department; a unique violation on save means a race,
 * and the caller retries once.
 */
export async function nextPublicRef(db: TenantDb, departmentId: string, departmentCode: string): Promise<string> {
  const count = await db.request.count({ where: { departmentId } });
  return `${departmentCode}-${1001 + count}`;
}
