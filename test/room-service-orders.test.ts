import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GuestStay } from "@/server/guest";
import { submitGuestRequest } from "@/server/guest-requests";
import { importOstroMenu, ROOM_SERVICE_ITEM_KEY } from "@/server/room-service/import";
import { placeServiceOrder, type OrderLineInput } from "@/server/room-service/orders";
import { parseOstroMenu } from "@/server/room-service/ostro-menu";
import { adminDb, createHotelWithData } from "./fixtures";

const menu = parseOstroMenu(readFileSync("prisma/data/ostro-menu.sql", "utf8"));

let hotelId: string;
let fbId: string;
let umbrellaId: string;
let guest: GuestStay;
let createStay: (opts?: { checkOutInDays?: number; revoked?: boolean }) => Promise<{ stay: { id: string } }>;

const itemOf = (key: string) => adminDb.serviceItem.findFirstOrThrow({ where: { hotelId, externalKey: key } });
const requestCount = () => adminDb.request.count({ where: { hotelId } });

beforeAll(async () => {
  const h = await createHotelWithData("rs-orders");
  hotelId = h.hotelId;
  createStay = h.createStay;
  // The import routes the umbrella item to Food & Beverage, so the department must exist first.
  fbId = (
    await adminDb.department.create({ data: { hotelId, code: "FB", nameEn: "Food & Beverage", nameAr: "الأغذية والمشروبات" } })
  ).id;
  await importOstroMenu(hotelId, menu);
  umbrellaId = (await adminDb.serviceItem.findFirstOrThrow({ where: { hotelId, externalKey: ROOM_SERVICE_ITEM_KEY } })).id;
  guest = { stayId: (await createStay()).stay.id, hotelId };
});

afterAll(async () => {
  await adminDb.$disconnect();
});

describe("placeServiceOrder", () => {
  it("places one request in F&B with one order and its lines", async () => {
    const a = await itemOf("ostro-1");
    const b = await itemOf("ostro-2");
    const r = await placeServiceOrder(guest, {
      lines: [
        { serviceItemId: a.id, qty: 2 },
        { serviceItemId: b.id, qty: 1 },
      ],
      guestNote: null,
    });
    expect(r.ok).toBe(true);

    const request = await adminDb.request.findUniqueOrThrow({ where: { id: r.requestId } });
    expect(request).toMatchObject({ serviceItemId: umbrellaId, departmentId: fbId, qty: 1 });

    const order = await adminDb.serviceOrder.findUniqueOrThrow({ where: { requestId: r.requestId } });
    expect(r.orderId).toBe(order.id);

    const lines = await adminDb.serviceOrderLine.findMany({ where: { orderId: order.id } });
    expect(lines).toHaveLength(2);
    const lineA = lines.find((l) => l.serviceItemId === a.id)!;
    const lineB = lines.find((l) => l.serviceItemId === b.id)!;
    expect(lineA).toMatchObject({ nameSnapshot: a.nameEn, qty: 2 });
    expect(Number(lineA.unitPrice)).toBe(Number(a.price));
    expect(lineB).toMatchObject({ nameSnapshot: b.nameEn, qty: 1 });
    expect(Number(lineB.unitPrice)).toBe(Number(b.price));

    const total = lines.reduce((sum, l) => sum + Number(l.unitPrice) * l.qty, 0);
    expect(total).toBe(Number(a.price) * 2 + Number(b.price));
  });

  it("ignores a price sent by the browser", async () => {
    const a = await itemOf("ostro-1");
    const forged = { serviceItemId: a.id, qty: 1, unitPrice: 1 } as unknown as OrderLineInput;
    const r = await placeServiceOrder(guest, { lines: [forged], guestNote: null });
    expect(r.ok).toBe(true);

    const line = await adminDb.serviceOrderLine.findFirstOrThrow({ where: { order: { requestId: r.requestId } } });
    expect(Number(line.unitPrice)).toBe(Number(a.price));
  });

  it("refuses an inactive item and creates nothing", async () => {
    const a = await itemOf("ostro-1");
    const before = await requestCount();
    await adminDb.serviceItem.update({ where: { id: a.id }, data: { isActive: false } });
    try {
      const r = await placeServiceOrder(guest, { lines: [{ serviceItemId: a.id, qty: 1 }], guestNote: null });
      expect(r.ok).toBe(false);
      expect(await requestCount()).toBe(before);
    } finally {
      await adminDb.serviceItem.update({ where: { id: a.id }, data: { isActive: true } });
    }
  });

  it("refuses an empty cart", async () => {
    const before = await requestCount();
    const r = await placeServiceOrder(guest, { lines: [], guestNote: null });
    expect(r.ok).toBe(false);
    expect(await requestCount()).toBe(before);
  });

  it("refuses quantity 0, quantity 21 and a non-integer quantity", async () => {
    const a = await itemOf("ostro-1");
    const before = await requestCount();
    for (const qty of [0, 21, 1.5]) {
      const r = await placeServiceOrder(guest, { lines: [{ serviceItemId: a.id, qty }], guestNote: null });
      expect(r.ok, `qty ${qty}`).toBe(false);
    }
    expect(await requestCount()).toBe(before);
  });

  it("refuses a stay that has checked out", async () => {
    const { stay } = await createStay();
    await adminDb.stay.update({ where: { id: stay.id }, data: { status: "CHECKED_OUT", tokenRevokedAt: new Date() } });
    const a = await itemOf("ostro-1");
    const before = await requestCount();
    const r = await placeServiceOrder({ stayId: stay.id, hotelId }, { lines: [{ serviceItemId: a.id, qty: 1 }], guestNote: null });
    expect(r.ok).toBe(false);
    expect(await requestCount()).toBe(before);
  });

  it("refuses an item from another hotel and creates nothing", async () => {
    const other = await createHotelWithData("rs-orders-other");
    const before = await requestCount();
    const r = await placeServiceOrder(guest, { lines: [{ serviceItemId: other.item.id, qty: 1 }], guestNote: null });
    expect(r.ok).toBe(false);
    expect(await requestCount()).toBe(before);
  });

  it("rolls back the request when the order cannot be saved", async () => {
    const before = await requestCount();
    const ordersBefore = await adminDb.serviceOrder.count({ where: { hotelId } });
    await expect(
      submitGuestRequest(guest, { serviceItemId: umbrellaId, qty: 1, guestNote: null }, null, async () => {
        throw new Error("order save failed");
      }),
    ).rejects.toThrow("order save failed");
    expect(await requestCount()).toBe(before);
    expect(await adminDb.serviceOrder.count({ where: { hotelId } })).toBe(ordersBefore);
  });

  it("keeps the price an order was placed at after the catalogue price changes", async () => {
    const a = await itemOf("ostro-1");
    const originalPrice = a.price!;
    const r = await placeServiceOrder(guest, { lines: [{ serviceItemId: a.id, qty: 1 }], guestNote: null });
    expect(r.ok).toBe(true);
    try {
      await adminDb.serviceItem.update({ where: { id: a.id }, data: { price: 99 } });
      const line = await adminDb.serviceOrderLine.findFirstOrThrow({ where: { order: { requestId: r.requestId } } });
      expect(Number(line.unitPrice)).toBe(Number(originalPrice));
    } finally {
      await adminDb.serviceItem.update({ where: { id: a.id }, data: { price: originalPrice } });
    }
  });
});
