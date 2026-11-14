import "server-only";
import { can, type Actor } from "@/server/auth/permissions";
import { tenantDb } from "@/server/db";
import { fail, ok, type ActionResult } from "@/server/forms";
import { isUuid } from "@/server/ids";
import { defaultPushSender, pushAlertToRecipients, requestAlertPayload, type PushSender } from "@/server/push";
import { departmentIds } from "@/server/requests/staff";
import { applyTransition } from "@/server/requests/transitions";
import type { RequestStatus } from "@/generated/prisma/enums";

/** Only requests nobody has started can move (spec: "a New or Accepted request"). */
const TRANSFERABLE: RequestStatus[] = ["RECEIVED", "ACCEPTED"];

type Db = ReturnType<typeof tenantDb>;

/** Supervisors of the department; if it has none, the hotel's admins (same rule as the alert job). */
async function alertRecipients(db: Db, departmentId: string): Promise<string[]> {
  const supervisors = await db.staffMembership.findMany({
    where: { role: "SUPERVISOR", departmentId },
    select: { staffUserId: true },
  });
  const rows =
    supervisors.length > 0
      ? supervisors
      : await db.staffMembership.findMany({ where: { role: "HOTEL_ADMIN" }, select: { staffUserId: true } });
  return [...new Set(rows.map((r) => r.staffUserId))];
}

/**
 * Moves a New or Accepted request to another active department of the same hotel. It becomes New there:
 * the assignee and acceptance are cleared, the alert clock restarts, and the receiving supervisors (or the
 * hotel admins) are alerted. Any staff member of the request's department may do this.
 */
export async function transferRequest(
  actor: Actor,
  requestId: string,
  toDepartmentId: string,
  reason: string,
  sender: PushSender | null = defaultPushSender(),
): Promise<ActionResult> {
  if (!can(actor, "requests.manage")) return fail("You don't have permission to do that.");
  const why = reason.trim();
  if (!why) return fail("Say why this request belongs to another department.");
  if (!isUuid(requestId)) return fail("This request was not found.");
  if (!isUuid(toDepartmentId)) return fail("Choose a department.");

  const db = tenantDb(actor.hotelId);
  const request = await db.request.findFirst({
    where: { id: requestId, departmentId: { in: departmentIds(actor) } },
    select: {
      status: true,
      departmentId: true,
      publicRef: true,
      room: { select: { number: true } },
      department: { select: { nameEn: true } },
    },
  });
  if (!request) return fail("You can only act on requests in your department.");
  if (!TRANSFERABLE.includes(request.status)) return fail("Only New or Accepted requests can be transferred.");
  if (request.departmentId === toDepartmentId) return fail("This request is already in that department.");

  const target = await db.department.findFirst({ where: { id: toDepartmentId, isActive: true }, select: { nameEn: true } });
  if (!target) return fail("Choose an active department in this hotel.");

  const now = new Date();
  const result = await applyTransition(actor.hotelId, {
    requestId,
    from: [request.status],
    to: "RECEIVED",
    actor: { type: "STAFF", id: actor.staffId },
    note: `Transferred from ${request.department.nameEn} to ${target.nameEn}: ${why}`,
    isInternal: true,
    patch: { departmentId: toDepartmentId, assigneeId: null, acceptedAt: null, transferredAt: now, alertedAt: now },
    match: { departmentId: request.departmentId },
  });
  if (!result.ok) return fail(result.message);

  const recipients = await alertRecipients(db, toDepartmentId);
  if (recipients.length > 0) {
    await db.notification.createMany({
      data: recipients.map((recipientStaffId) => ({ hotelId: actor.hotelId, recipientStaffId, type: "REQUEST_ALERT", requestId })),
    });
    const payload = requestAlertPayload(
      { id: requestId, publicRef: request.publicRef, roomNumber: request.room.number },
      `Request ${request.publicRef} transferred to ${target.nameEn}`,
    );
    await pushAlertToRecipients(actor.hotelId, recipients, payload, sender);
  }
  return ok(`Transferred to ${target.nameEn}.`);
}

/** The departments a member of `fromDepartmentId` can transfer a request to. Empty for anyone else. */
export async function listTransferTargets(actor: Actor, fromDepartmentId: string): Promise<{ id: string; name: string }[]> {
  if (!can(actor, "requests.manage") || !departmentIds(actor).includes(fromDepartmentId)) return [];
  const rows = await tenantDb(actor.hotelId).department.findMany({
    where: { isActive: true, id: { not: fromDepartmentId } },
    orderBy: { nameEn: "asc" },
    select: { id: true, nameEn: true },
  });
  return rows.map((d) => ({ id: d.id, name: d.nameEn }));
}
