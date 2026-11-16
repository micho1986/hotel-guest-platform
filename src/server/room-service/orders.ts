import "server-only";
import { fail } from "@/server/forms";
import type { GuestStay } from "@/server/guest";
import { tenantDb } from "@/server/db";
import { submitGuestRequest, type GuestRequestResult } from "@/server/guest-requests";
import { defaultPushSender, type PushSender } from "@/server/push";
import { ROOM_SERVICE_ITEM_KEY } from "@/server/room-service/import";

export type OrderLineInput = { serviceItemId: string; qty: number };

const MAX_LINES = 50;
const MAX_QTY = 20;

/**
 * One cart, one order: a single F&B request for the whole cart, with its lines.
 * The browser sends only item ids and quantities. Names and prices are read from the catalogue here,
 * and copied onto each line so later catalogue changes never alter an order.
 */
export async function placeServiceOrder(
  guest: GuestStay,
  input: { lines: OrderLineInput[]; guestNote: string | null },
  sender: PushSender | null = defaultPushSender(),
): Promise<GuestRequestResult & { orderId?: string }> {
  const { lines } = input;
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_LINES) return fail("Your order is empty or too large.");
  if (lines.some((l) => !Number.isInteger(l.qty) || l.qty < 1 || l.qty > MAX_QTY)) {
    return fail(`Choose a quantity from 1 to ${MAX_QTY}.`);
  }

  const db = tenantDb(guest.hotelId);
  const ids = [...new Set(lines.map((l) => l.serviceItemId))];
  const items = await db.serviceItem.findMany({
    where: { id: { in: ids }, isActive: true, deletedAt: null, department: { code: "FB" } },
    select: { id: true, nameEn: true, price: true },
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  const priced = lines.map((l) => {
    const item = byId.get(l.serviceItemId);
    return item && item.price !== null ? { item: { id: item.id, nameEn: item.nameEn }, price: item.price, qty: l.qty } : null;
  });
  const complete = priced.filter((p): p is NonNullable<typeof p> => p !== null);
  if (complete.length !== lines.length) return fail("One or more items are not available.");

  const umbrella = await db.serviceItem.findFirst({
    where: { externalKey: ROOM_SERVICE_ITEM_KEY, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (!umbrella) return fail("Room service is not available.");

  let orderId: string | undefined;
  const result = await submitGuestRequest(
    guest,
    { serviceItemId: umbrella.id, qty: 1, guestNote: input.guestNote },
    sender,
    async (tx, requestId) => {
      const order = await tx.serviceOrder.create({ data: { hotelId: guest.hotelId, requestId } });
      await tx.serviceOrderLine.createMany({
        data: complete.map((p) => ({
          hotelId: guest.hotelId,
          orderId: order.id,
          serviceItemId: p.item.id,
          nameSnapshot: p.item.nameEn,
          unitPrice: p.price,
          qty: p.qty,
        })),
      });
      orderId = order.id;
    },
  );
  return { ...result, orderId: result.ok ? orderId : undefined };
}
