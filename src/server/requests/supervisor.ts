import "server-only";
import { can, type Actor } from "@/server/auth/permissions";
import { tenantDb } from "@/server/db";
import { fail, ok, type ActionResult } from "@/server/forms";
import { isUuid } from "@/server/ids";
import { defaultPushSender, pushAlertToRecipients, requestAlertPayload, type PushSender } from "@/server/push";
import { ASSIGNED_TYPE } from "@/server/requests/notifications";
import { applyTransition } from "@/server/requests/transitions";
import type { RequestStatus, StaffRole } from "@/generated/prisma/enums";

/** Statuses in which a supervisor may assign, reassign or cancel (spec: "New or Accepted"). */
const SUPERVISABLE: RequestStatus[] = ["RECEIVED", "ACCEPTED"];
/** Roles that can be given a request: the department's employees and supervisors. */
const ASSIGNABLE_ROLES: StaffRole[] = ["EMPLOYEE", "SUPERVISOR"];
const ACTIVE_STAFF = { status: "ACTIVE", deletedAt: null } as const;

type SupervisedRequest = {
  id: string;
  status: RequestStatus;
  assigneeId: string | null;
  departmentId: string;
  publicRef: string;
  room: { number: string };
};
type Lookup<T> = { ok: true; value: T } | { ok: false; result: ActionResult };

/** The departments this actor supervises. A GM or employee supervises none. */
export function supervisedDepartmentIds(actor: Actor): string[] {
  return actor.memberships
    .filter((m) => m.role === "SUPERVISOR")
    .map((m) => m.departmentId)
    .filter((d): d is string => d !== null);
}

/** The request, if the actor is a signed-in supervisor of its department and it is New or Accepted. */
async function findSupervisedRequest(actor: Actor, requestId: string): Promise<Lookup<SupervisedRequest>> {
  const departments = supervisedDepartmentIds(actor);
  if (!can(actor, "requests.manage") || departments.length === 0) {
    return { ok: false, result: fail("Only a supervisor of this department can do that.") };
  }
  if (!isUuid(requestId)) return { ok: false, result: fail("This request was not found.") };
  const request = await tenantDb(actor.hotelId).request.findFirst({
    where: { id: requestId, departmentId: { in: departments } },
    select: { id: true, status: true, assigneeId: true, departmentId: true, publicRef: true, room: { select: { number: true } } },
  });
  if (!request) return { ok: false, result: fail("You can only act on requests in a department you supervise.") };
  if (!SUPERVISABLE.includes(request.status)) {
    return { ok: false, result: fail("Only New or Accepted requests can be changed here.") };
  }
  return { ok: true, value: request };
}

/** An active staff member who works in the department (employee or supervisor). Returns their name. */
async function findDepartmentMember(hotelId: string, departmentId: string, staffId: string): Promise<string | null> {
  if (!isUuid(staffId)) return null;
  const membership = await tenantDb(hotelId).staffMembership.findFirst({
    where: {
      staffUserId: staffId,
      departmentId,
      role: { in: ASSIGNABLE_ROLES },
      staffUser: ACTIVE_STAFF,
    },
    select: { staffUser: { select: { name: true } } },
  });
  return membership?.staffUser.name ?? null;
}

/**
 * Sets the assignee without changing status: one event, with the status unchanged and a note naming the
 * staff member. `match` pins the previous assignee (two supervisors racing cannot both succeed) and the
 * department (a transfer committed after this read cannot be overridden). The new assignee is notified
 * and pushed, so they know the request is theirs.
 */
async function setAssignee(
  actor: Actor,
  request: SupervisedRequest,
  staffId: string,
  label: string,
  sender: PushSender | null,
): Promise<ActionResult> {
  const name = await findDepartmentMember(actor.hotelId, request.departmentId, staffId);
  if (!name) return fail("Choose someone who works in this request's department.");
  if (request.assigneeId === staffId) return fail(`This request is already with ${name}.`);

  const result = await applyTransition(actor.hotelId, {
    requestId: request.id,
    from: [request.status],
    to: request.status,
    actor: { type: "STAFF", id: actor.staffId },
    note: `${label} to ${name}.`,
    isInternal: true,
    patch: { assigneeId: staffId },
    match: { assigneeId: request.assigneeId, departmentId: request.departmentId },
  });
  if (!result.ok) return fail(result.message);

  await tenantDb(actor.hotelId).notification.create({
    data: { hotelId: actor.hotelId, recipientStaffId: staffId, type: ASSIGNED_TYPE, requestId: request.id },
  });
  const payload = requestAlertPayload(
    { id: request.id, publicRef: request.publicRef, roomNumber: request.room.number },
    `Request ${request.publicRef} is yours`,
  );
  await pushAlertToRecipients(actor.hotelId, [staffId], payload, sender);
  return ok(`${label} to ${name}.`);
}

/** Gives a request with no assignee to a member of its department. */
export async function assignRequest(
  actor: Actor,
  requestId: string,
  staffId: string,
  sender: PushSender | null = defaultPushSender(),
): Promise<ActionResult> {
  const found = await findSupervisedRequest(actor, requestId);
  if (!found.ok) return found.result;
  if (found.value.assigneeId !== null) return fail("This request already has someone on it. Reassign it instead.");
  return setAssignee(actor, found.value, staffId, "Assigned", sender);
}

/** Moves a request from its current assignee to another member of its department. */
export async function reassignRequest(
  actor: Actor,
  requestId: string,
  staffId: string,
  sender: PushSender | null = defaultPushSender(),
): Promise<ActionResult> {
  const found = await findSupervisedRequest(actor, requestId);
  if (!found.ok) return found.result;
  if (found.value.assigneeId === null) return fail("Nobody has this request yet. Assign it instead.");
  return setAssignee(actor, found.value, staffId, "Reassigned", sender);
}

/** Cancels a New or Accepted request. The reason is required and kept as an internal note. */
export async function cancelStaffRequest(actor: Actor, requestId: string, reason: string): Promise<ActionResult> {
  const note = reason.trim();
  if (!note) return fail("Give a reason for cancelling this request.");
  const found = await findSupervisedRequest(actor, requestId);
  if (!found.ok) return found.result;

  const result = await applyTransition(actor.hotelId, {
    requestId,
    from: SUPERVISABLE,
    to: "CANCELLED",
    actor: { type: "STAFF", id: actor.staffId },
    note,
    isInternal: true,
    match: { departmentId: found.value.departmentId },
  });
  if (!result.ok) return fail(result.message);
  return ok("Request cancelled.");
}

/** The people a supervisor can give this department's requests to, by name. Empty for anyone else. */
export async function listAssignableStaff(actor: Actor, departmentId: string): Promise<{ id: string; name: string }[]> {
  if (!can(actor, "requests.manage") || !supervisedDepartmentIds(actor).includes(departmentId)) return [];
  const rows = await tenantDb(actor.hotelId).staffMembership.findMany({
    where: { departmentId, role: { in: ASSIGNABLE_ROLES }, staffUser: ACTIVE_STAFF },
    select: { staffUser: { select: { id: true, name: true } } },
  });
  const unique = new Map(rows.map((r) => [r.staffUser.id, r.staffUser.name]));
  return [...unique].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
