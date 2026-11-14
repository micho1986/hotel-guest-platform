import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/server/auth/permissions";
import { tenantDb } from "@/server/db";
import { isUuid } from "@/server/ids";

/** A New request is waiting: written at creation, by the alert job each window, and on transfer (M4). */
export const ALERT_TYPE = "REQUEST_ALERT";
/** A supervisor gave a request to someone: written for the new assignee (M4). */
export const ASSIGNED_TYPE = "REQUEST_ASSIGNED";

const ACTIVE_STAFF = { status: "ACTIVE", deletedAt: null } as const;

/**
 * Who is alerted about a department's New request: its active supervisors, or, when it has none, the
 * hotel's active admins. Disabled or deleted staff never count, so a department whose only supervisor
 * left falls back to the admins. Runs on a tenant transaction; hotelId is in every filter.
 */
export async function alertRecipients(tx: Prisma.TransactionClient, hotelId: string, departmentId: string): Promise<string[]> {
  const supervisors = await tx.staffMembership.findMany({
    where: { hotelId, role: "SUPERVISOR", departmentId, staffUser: ACTIVE_STAFF },
    select: { staffUserId: true },
  });
  const rows =
    supervisors.length > 0
      ? supervisors
      : await tx.staffMembership.findMany({
          where: { hotelId, role: "HOTEL_ADMIN", staffUser: ACTIVE_STAFF },
          select: { staffUserId: true },
        });
  return [...new Set(rows.map((r) => r.staffUserId))];
}

/**
 * How many requests are waiting on this staff member: New requests they were alerted about, and New or
 * Accepted requests given to them. Each request counts once; once it moves on, it stops counting.
 */
export async function countUnreadAlerts(actor: Actor): Promise<number> {
  const rows = await tenantDb(actor.hotelId).notification.findMany({
    where: {
      recipientStaffId: actor.staffId,
      readAt: null,
      OR: [
        { type: ALERT_TYPE, request: { status: "RECEIVED" } },
        { type: ASSIGNED_TYPE, request: { status: { in: ["RECEIVED", "ACCEPTED"] } } },
      ],
    },
    distinct: ["requestId"],
    select: { requestId: true },
  });
  return rows.length;
}

/** Opening a request clears the viewer's alerts and assignment notices for it; other recipients keep theirs. */
export async function markRequestAlertsRead(actor: Actor, requestId: string): Promise<void> {
  if (!isUuid(requestId)) return;
  await tenantDb(actor.hotelId).notification.updateMany({
    where: { recipientStaffId: actor.staffId, requestId, type: { in: [ALERT_TYPE, ASSIGNED_TYPE] }, readAt: null },
    data: { readAt: new Date() },
  });
}
