import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { tenantTransaction } from "@/server/db";
import { isAlertDue } from "@/server/requests/alerts";

/**
 * The job reads New requests across every hotel, so it uses the admin connection, not the tenant-scoped
 * runtime role. Only the route that checks ALERT_JOB_SECRET calls it. Every write is tenant-scoped.
 */
let admin: PrismaClient | null = null;
function adminDb(): PrismaClient {
  admin ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_ADMIN_URL! }) });
  return admin;
}

/** Supervisors of the request's department; if there are none, the hotel's admins. */
async function recipientsFor(hotelId: string, departmentId: string): Promise<string[]> {
  const db = adminDb();
  const supervisors = await db.staffMembership.findMany({
    where: { hotelId, role: "SUPERVISOR", departmentId },
    select: { staffUserId: true },
  });
  if (supervisors.length > 0) return [...new Set(supervisors.map((s) => s.staffUserId))];
  const admins = await db.staffMembership.findMany({
    where: { hotelId, role: "HOTEL_ADMIN" },
    select: { staffUserId: true },
  });
  return [...new Set(admins.map((a) => a.staffUserId))];
}

/**
 * Alerts every due New request once per window. Idempotent: the claim updates alertedAt only if it still
 * holds the value this run read, so two runs, or two servers, cannot both alert the same window.
 */
export async function runAlertJob(now: Date): Promise<{ alerted: number }> {
  const candidates = await adminDb().request.findMany({
    where: { status: "RECEIVED" },
    select: { id: true, hotelId: true, departmentId: true, priority: true, status: true, createdAt: true, alertedAt: true },
  });

  let alerted = 0;
  for (const r of candidates) {
    if (!isAlertDue(r, now)) continue;
    const recipients = await recipientsFor(r.hotelId, r.departmentId);
    if (recipients.length === 0) continue;

    const claimed = await tenantTransaction(r.hotelId, async (tx) => {
      const moved = await tx.request.updateMany({
        where: { id: r.id, hotelId: r.hotelId, status: "RECEIVED", alertedAt: r.alertedAt },
        data: { alertedAt: now, escalationLevel: 1 },
      });
      if (moved.count !== 1) return false;
      await tx.notification.createMany({
        data: recipients.map((recipientStaffId) => ({
          hotelId: r.hotelId,
          recipientStaffId,
          type: "REQUEST_ALERT",
          requestId: r.id,
        })),
      });
      return true;
    });
    if (claimed) alerted++;
  }
  return { alerted };
}
