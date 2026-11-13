import "server-only";
import type { Actor } from "@/server/auth/permissions";
import { dbFor } from "./common";

/** The most recent audit entries, with the actor's name where known. */
export async function listAuditLog(actor: Actor, limit = 200) {
  const db = dbFor(actor, "audit.view");
  const entries = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(limit, 500) });
  const actorIds = [...new Set(entries.map((e) => e.actorId).filter((v): v is string => v !== null))];
  const people = await db.staffUser.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  const names = new Map(people.map((p) => [p.id, p.name]));
  return entries.map((e) => ({ ...e, actorName: e.actorId ? (names.get(e.actorId) ?? "Unknown") : "System" }));
}
