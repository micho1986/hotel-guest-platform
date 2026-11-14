import "server-only";
import { isUniqueViolation } from "@/server/admin/common";
import { tenantDb, tenantTransaction } from "@/server/db";
import type { GuestStay } from "@/server/guest";
import { fail, ok, type ActionResult } from "@/server/forms";

export type GuestRequestResult = ActionResult & { requestId?: string; publicRef?: string };

/**
 * A guest's request. Checks the stay is still open, the item is orderable,
 * the quantity and note are valid, then saves the request and its first event.
 * The department comes from the item, never from the guest.
 */
export async function submitGuestRequest(
  guest: GuestStay,
  input: { serviceItemId: string; qty: number; guestNote: string | null },
): Promise<GuestRequestResult> {
  const db = tenantDb(guest.hotelId);

  const stay = await db.stay.findFirst({ where: { id: guest.stayId }, select: { id: true, roomId: true, status: true, tokenRevokedAt: true } });
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
        return { requestId: request.id, publicRef };
      });
      return { ...ok(`Request ${created.publicRef} sent.`), requestId: created.requestId, publicRef: created.publicRef };
    } catch (e) {
      if (!isUniqueViolation(e) || attempt === 1) throw e;
    }
  }
  throw new Error("unreachable");
}
