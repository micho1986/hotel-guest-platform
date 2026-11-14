import "server-only";
import { can, type Actor } from "@/server/auth/permissions";
import { dbFor } from "@/server/admin/common";
import { tenantDb } from "@/server/db";
import { fail, ok, type ActionResult } from "@/server/forms";
import { applyTransition } from "@/server/requests/transitions";
import type { RequestStatus } from "@/generated/prisma/enums";

export type QueueTab = "new" | "mine" | "in_progress" | "done_today";

const OPEN: RequestStatus[] = ["ACCEPTED", "IN_PROGRESS", "WAITING_FOR_GUEST"];

/** GM sees every department; everyone else sees only the departments they belong to. */
function viewScope(actor: Actor): Record<string, unknown> {
  if (actor.memberships.some((m) => m.role === "GM")) return {};
  return { departmentId: { in: departmentIds(actor) } };
}

function departmentIds(actor: Actor): string[] {
  return actor.memberships.map((m) => m.departmentId).filter((d): d is string => d !== null);
}

/** Midnight at the start of today in Dubai, as an instant. Dubai has no daylight saving. */
export function startOfDubaiDay(now: Date = new Date()): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(now);
  return new Date(`${ymd}T00:00:00+04:00`);
}

function tabWhere(actor: Actor, tab: QueueTab): Record<string, unknown> {
  switch (tab) {
    case "new":
      return { status: "RECEIVED" };
    case "mine":
      return { assigneeId: actor.staffId, status: { in: OPEN } };
    case "in_progress":
      return { status: { in: OPEN } };
    case "done_today":
      return { status: "COMPLETED", completedAt: { gte: startOfDubaiDay() } };
  }
}

/** The queue for one tab. Urgent requests come first, then oldest first. Guest names are never selected. */
export async function listQueue(actor: Actor, tab: QueueTab) {
  const db = dbFor(actor, "requests.view");
  const rows = await db.request.findMany({
    where: { ...viewScope(actor), ...tabWhere(actor, tab) },
    select: {
      id: true,
      publicRef: true,
      status: true,
      qty: true,
      priority: true,
      createdAt: true,
      assigneeId: true,
      room: { select: { number: true } },
      serviceItem: { select: { nameEn: true } },
      department: { select: { code: true } },
    },
  });
  return rows.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === "URGENT" ? -1 : 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

/** One request with its full timeline, for staff in its department. No guest name is selected. */
export async function getRequestForStaff(actor: Actor, requestId: string) {
  const db = dbFor(actor, "requests.view");
  return db.request.findFirst({
    where: { id: requestId, ...viewScope(actor) },
    select: {
      id: true,
      publicRef: true,
      status: true,
      qty: true,
      priority: true,
      guestNote: true,
      createdAt: true,
      acceptedAt: true,
      startedAt: true,
      completedAt: true,
      assigneeId: true,
      departmentId: true,
      room: { select: { number: true } },
      serviceItem: { select: { nameEn: true, nameAr: true } },
      department: { select: { code: true, nameEn: true } },
      events: {
        orderBy: { createdAt: "asc" },
        select: { actorType: true, fromStatus: true, toStatus: true, note: true, isInternal: true, createdAt: true },
      },
    },
  });
}

type Step = {
  from: RequestStatus[];
  to: RequestStatus;
  label: string;
  needsAssignee?: boolean;
  note?: string | null;
  isInternal?: boolean;
  patch?: Record<string, unknown>;
  afterSuccess?: (db: ReturnType<typeof tenantDb>, requestId: string, departmentId: string, actor: Actor) => Promise<void>;
};

/**
 * Every staff action runs through here: the actor needs the manage permission and must belong to the
 * request's department; the assignee rule applies where the step says so; then the transition service
 * does the change and its event.
 */
async function act(actor: Actor, requestId: string, step: Step): Promise<ActionResult> {
  if (!can(actor, "requests.manage")) return fail("You don't have permission to do that.");
  const db = tenantDb(actor.hotelId);
  const request = await db.request.findFirst({
    where: { id: requestId, departmentId: { in: departmentIds(actor) } },
    select: { id: true, status: true, assigneeId: true, departmentId: true },
  });
  if (!request) return fail("You can only act on requests in your department.");
  if (step.needsAssignee && request.assigneeId !== actor.staffId) {
    return fail("Only the person who accepted this request can do that.");
  }

  const result = await applyTransition(actor.hotelId, {
    requestId,
    from: step.from,
    to: step.to,
    actor: { type: "STAFF", id: actor.staffId },
    note: step.note ?? null,
    isInternal: step.isInternal ?? false,
    patch: step.patch,
  });
  if (!result.ok) return fail(result.message);
  if (step.afterSuccess) await step.afterSuccess(db, requestId, request.departmentId, actor);
  return ok(step.label);
}

export function acceptRequest(actor: Actor, requestId: string) {
  return act(actor, requestId, {
    from: ["RECEIVED"],
    to: "ACCEPTED",
    label: "Accepted.",
    patch: { assigneeId: actor.staffId, acceptedAt: new Date() },
  });
}

/** Sends the request back to the queue. The reason is required and is kept in the timeline. */
export function rejectRequest(actor: Actor, requestId: string, reason: string) {
  const note = reason.trim();
  if (!note) return Promise.resolve(fail("Give a reason for rejecting this request."));
  return act(actor, requestId, {
    from: ["RECEIVED"],
    to: "RECEIVED",
    label: "Rejected. It is back in the queue.",
    note,
    isInternal: true,
    afterSuccess: async (db, id, departmentId, who) => {
      const supervisors = await db.staffMembership.findMany({
        where: { role: "SUPERVISOR", departmentId },
        select: { staffUserId: true },
      });
      if (supervisors.length === 0) return;
      await db.notification.createMany({
        data: supervisors.map((s) => ({ hotelId: who.hotelId, recipientStaffId: s.staffUserId, type: "REQUEST_REJECTED", requestId: id })),
      });
    },
  });
}

export function startRequest(actor: Actor, requestId: string) {
  return act(actor, requestId, {
    from: ["ACCEPTED"],
    to: "IN_PROGRESS",
    label: "Started.",
    needsAssignee: true,
    patch: { startedAt: new Date() },
  });
}

export function waitForGuest(actor: Actor, requestId: string, reason: string) {
  const note = reason.trim();
  if (!note) return Promise.resolve(fail("Say why you need the guest, for example “guest not in room”."));
  return act(actor, requestId, {
    from: ["IN_PROGRESS"],
    to: "WAITING_FOR_GUEST",
    label: "Waiting for the guest.",
    needsAssignee: true,
    note,
    isInternal: true,
  });
}

export function resumeRequest(actor: Actor, requestId: string) {
  return act(actor, requestId, {
    from: ["WAITING_FOR_GUEST"],
    to: "IN_PROGRESS",
    label: "Resumed.",
    needsAssignee: true,
  });
}

export function completeRequest(actor: Actor, requestId: string) {
  return act(actor, requestId, {
    from: ["IN_PROGRESS"],
    to: "COMPLETED",
    label: "Completed.",
    needsAssignee: true,
    patch: { completedAt: new Date() },
  });
}

/** A note on the timeline that does not change status. Only staff see it. */
export async function addInternalNote(actor: Actor, requestId: string, text: string): Promise<ActionResult> {
  if (!can(actor, "requests.manage")) return fail("You don't have permission to do that.");
  const note = text.trim();
  if (!note) return fail("Write a note first.");
  const db = tenantDb(actor.hotelId);
  const request = await db.request.findFirst({
    where: { id: requestId, departmentId: { in: departmentIds(actor) } },
    select: { id: true, status: true },
  });
  if (!request) return fail("You can only act on requests in your department.");
  await db.requestEvent.create({
    data: {
      hotelId: actor.hotelId,
      requestId,
      actorType: "STAFF",
      actorId: actor.staffId,
      fromStatus: request.status,
      toStatus: request.status,
      note,
      isInternal: true,
    },
  });
  return ok("Note added.");
}
