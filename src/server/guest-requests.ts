import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { isUniqueViolation } from "@/server/admin/common";
import { tenantDb, tenantTransaction } from "@/server/db";
import type { GuestStay } from "@/server/guest";
import { fail, ok, type ActionResult } from "@/server/forms";
import { defaultPushSender, pushAlertToRecipients, requestAlertPayload, type PushSender } from "@/server/push";
import { ALERT_TYPE, alertRecipients } from "@/server/requests/notifications";
import { applyTransition } from "@/server/requests/transitions";

export type GuestRequestResult = ActionResult & { requestId?: string; publicRef?: string };

/**
 * A guest's request. Checks the stay is still open, the item is orderable,
 * the quantity and note are valid, then saves the request and its first event.
 * The department comes from the item, never from the guest. The department's supervisors (or, with none,
 * the hotel admins) are alerted at once, and the alert clock starts (spec M4 Goal 1).
 */
export async function submitGuestRequest(
  guest: GuestStay,
  input: { serviceItemId: string; qty: number; guestNote: string | null },
  sender: PushSender | null = defaultPushSender(),
  afterCreate?: (tx: Prisma.TransactionClient, requestId: string) => Promise<void>,
): Promise<GuestRequestResult> {
  const db = tenantDb(guest.hotelId);

  const stay = await db.stay.findFirst({
    where: { id: guest.stayId },
    select: { id: true, roomId: true, status: true, tokenRevokedAt: true, room: { select: { number: true } } },
  });
  if (!stay || stay.status !== "ACTIVE" || stay.tokenRevokedAt) return fail("This link is no longer active.");

  const item = await db.serviceItem.findFirst({
    where: { id: input.serviceItemId, isActive: true, deletedAt: null },
    include: { department: { select: { id: true, code: true } } },
  });
  if (!item) return fail("This service is not available.");
  if (!Number.isInteger(input.qty) || input.qty < 1 || input.qty > item.maxQty) return fail(`Choose a quantity from 1 to ${item.maxQty}.`);

  const note = input.guestNote?.trim() || null;
  if (item.needsNote && !note) return fail("Please describe your request.");

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // One transaction: the request, its SUBMITTED event, then the system's RECEIVED routing.
      // A reader never sees a submitted request that no queue shows.
      const created = await tenantTransaction(guest.hotelId, async (tx) => {
        const count = await tx.request.count({ where: { hotelId: guest.hotelId, departmentId: item.departmentId } });
        const publicRef = `${item.department.code}-${1001 + count}`;
        const request = await tx.request.create({
          data: {
            hotelId: guest.hotelId,
            publicRef,
            stayId: guest.stayId,
            roomId: stay.roomId,
            serviceItemId: item.id,
            departmentId: item.departmentId,
            qty: input.qty,
            guestNote: note,
            status: "RECEIVED",
            alertedAt: new Date(),
          },
        });
        await tx.requestEvent.create({
          data: { hotelId: guest.hotelId, requestId: request.id, actorType: "GUEST", toStatus: "SUBMITTED" },
        });
        await tx.requestEvent.create({
          data: {
            hotelId: guest.hotelId,
            requestId: request.id,
            actorType: "SYSTEM",
            fromStatus: "SUBMITTED",
            toStatus: "RECEIVED",
          },
        });
        if (afterCreate) await afterCreate(tx, request.id);
        const recipients = await alertRecipients(tx, guest.hotelId, item.departmentId);
        if (recipients.length > 0) {
          await tx.notification.createMany({
            data: recipients.map((recipientStaffId) => ({ hotelId: guest.hotelId, recipientStaffId, type: ALERT_TYPE, requestId: request.id })),
          });
        }
        return { requestId: request.id, publicRef, recipients };
      });
      const payload = requestAlertPayload(
        { id: created.requestId, publicRef: created.publicRef, roomNumber: stay.room.number },
        `New request ${created.publicRef}`,
      );
      await pushAlertToRecipients(guest.hotelId, created.recipients, payload, sender);
      return { ...ok(`Request ${created.publicRef} sent.`), requestId: created.requestId, publicRef: created.publicRef };
    } catch (e) {
      if (!isUniqueViolation(e) || attempt === 1) throw e;
    }
  }
  throw new Error("unreachable");
}

/** The request, only if it belongs to this guest's stay. Anything else looks the same as not found. */
async function ownRequest(guest: GuestStay, requestId: string) {
  return tenantDb(guest.hotelId).request.findFirst({
    where: { id: requestId, stayId: guest.stayId },
    select: { id: true, status: true },
  });
}

/** A guest may cancel only until the request is accepted. */
export async function cancelGuestRequest(guest: GuestStay, requestId: string): Promise<ActionResult> {
  if (!(await ownRequest(guest, requestId))) return fail("This request was not found.");
  const result = await applyTransition(guest.hotelId, {
    requestId,
    from: ["SUBMITTED", "RECEIVED"],
    to: "CANCELLED",
    actor: { type: "GUEST", id: null },
  });
  if (!result.ok) return fail(result.message);
  return ok("Request cancelled.");
}

export type GuestRatingInput = { rating: number; comment: string | null };

/** One rating per request, only once it is completed. The unique key on the request enforces "once". */
export async function rateGuestRequest(guest: GuestStay, requestId: string, input: GuestRatingInput): Promise<ActionResult> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) return fail("Choose a rating from 1 to 5.");
  const request = await ownRequest(guest, requestId);
  if (!request) return fail("This request was not found.");
  if (request.status !== "COMPLETED") return fail("You can rate a request once it is completed.");
  const comment = input.comment?.trim() || null;
  try {
    await tenantDb(guest.hotelId).requestFeedback.create({
      data: { hotelId: guest.hotelId, requestId, rating: input.rating, comment },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("You have already rated this request.");
    throw e;
  }
  return ok("Thank you for your feedback.");
}

/** The status steps a guest may see for one of their requests. Internal notes are never selected. */
export async function guestTimeline(guest: GuestStay, requestId: string) {
  return tenantDb(guest.hotelId).requestEvent.findMany({
    where: { requestId, isInternal: false, request: { stayId: guest.stayId } },
    orderBy: { createdAt: "asc" },
    select: { toStatus: true, createdAt: true },
  });
}

/** This guest's rating for one of their requests, or null if there is none. */
export async function guestFeedback(guest: GuestStay, requestId: string) {
  return tenantDb(guest.hotelId).requestFeedback.findFirst({
    where: { requestId, request: { stayId: guest.stayId } },
    select: { rating: true, comment: true },
  });
}
