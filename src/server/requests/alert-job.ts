import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { tenantTransaction } from "@/server/db";
import { pgConfig } from "@/server/pg-connection";
import { defaultPushSender, pushAlertToRecipients, requestAlertPayload, type PushSender } from "@/server/push";
import { isAlertDue } from "@/server/requests/alerts";
import { ALERT_TYPE, alertRecipients } from "@/server/requests/notifications";

/**
 * The job reads New requests across every hotel, so it uses the admin connection, not the tenant-scoped
 * runtime role. Only the route that checks ALERT_JOB_SECRET calls it. Every write is tenant-scoped.
 */
let admin: PrismaClient | null = null;
function adminDb(): PrismaClient {
  admin ??= new PrismaClient({ adapter: new PrismaPg(pgConfig(process.env.DATABASE_ADMIN_URL!)) });
  return admin;
}

type Candidate = {
  id: string;
  hotelId: string;
  departmentId: string;
  alertedAt: Date | null;
  publicRef: string;
  room: { number: string };
};

/**
 * Claims one due request's window and writes its alerts in one tenant transaction. The claim updates
 * alertedAt only if it still holds the value this run read. Returns the recipients, or null when another
 * run already claimed the window or nobody can be alerted.
 */
async function claimAndAlert(r: Candidate, now: Date): Promise<string[] | null> {
  return tenantTransaction(r.hotelId, async (tx) => {
    const recipients = await alertRecipients(tx, r.hotelId, r.departmentId);
    if (recipients.length === 0) return null;
    const moved = await tx.request.updateMany({
      where: { id: r.id, hotelId: r.hotelId, status: "RECEIVED", alertedAt: r.alertedAt },
      data: { alertedAt: now, escalationLevel: 1 },
    });
    if (moved.count !== 1) return null;
    await tx.notification.createMany({
      data: recipients.map((recipientStaffId) => ({ hotelId: r.hotelId, recipientStaffId, type: ALERT_TYPE, requestId: r.id })),
    });
    return recipients;
  });
}

/**
 * Alerts every due New request once per window. Idempotent: the claim updates alertedAt only if it still
 * holds the value this run read, so two runs, or two servers, cannot both alert the same window. A request
 * that fails is logged and counted, and the run goes on to the rest.
 */
export async function runAlertJob(
  now: Date,
  sender: PushSender | null = defaultPushSender(),
): Promise<{ alerted: number; failed: number }> {
  const candidates = await adminDb().request.findMany({
    where: { status: "RECEIVED" },
    select: {
      id: true,
      hotelId: true,
      departmentId: true,
      priority: true,
      status: true,
      createdAt: true,
      alertedAt: true,
      publicRef: true,
      room: { select: { number: true } },
    },
  });

  let alerted = 0;
  let failed = 0;
  for (const r of candidates) {
    if (!isAlertDue(r, now)) continue;
    let recipients: string[] | null;
    try {
      recipients = await claimAndAlert(r, now);
    } catch (e) {
      failed++;
      console.error("alert job: could not alert request", { hotelId: r.hotelId, requestId: r.id, error: e instanceof Error ? e.message : e });
      continue;
    }
    if (!recipients) continue;
    alerted++;
    const payload = requestAlertPayload(
      { id: r.id, publicRef: r.publicRef, roomNumber: r.room.number },
      `Request ${r.publicRef} is still waiting`,
    );
    await pushAlertToRecipients(r.hotelId, recipients, payload, sender);
  }
  return { alerted, failed };
}
