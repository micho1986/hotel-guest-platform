import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GuestStay } from "@/server/guest";
import { importOstroMenu, ROOM_SERVICE_CATEGORY_KEY } from "@/server/room-service/import";
import { listRoomServiceMenu } from "@/server/room-service/menu";
import { parseOstroMenu } from "@/server/room-service/ostro-menu";
import { adminDb, createHotelWithData } from "./fixtures";

const menu = parseOstroMenu(readFileSync("prisma/data/ostro-menu.sql", "utf8"));

let hotelId: string;
let guest: GuestStay;
let createStay: (opts?: { checkOutInDays?: number; revoked?: boolean }) => Promise<{ stay: { id: string } }>;

beforeAll(async () => {
  const h = await createHotelWithData("rs-menu");
  hotelId = h.hotelId;
  createStay = h.createStay;
  await adminDb.department.create({ data: { hotelId, code: "FB", nameEn: "Food & Beverage", nameAr: "الأغذية والمشروبات" } });
  await importOstroMenu(hotelId, menu);
  guest = { stayId: (await createStay()).stay.id, hotelId };
});

afterAll(async () => {
  await adminDb.$disconnect();
});

describe("listRoomServiceMenu", () => {
  it("lists the Ostro categories and their available items, never the umbrella category", async () => {
    const cats = await listRoomServiceMenu(guest);
    expect(cats).toHaveLength(17);
    expect(cats.some((c) => c.key === ROOM_SERVICE_CATEGORY_KEY)).toBe(false);
    for (const c of cats) {
      for (const item of c.items) {
        expect(typeof item.price).toBe("number");
      }
    }
  });

  it("leaves out an item that is inactive", async () => {
    const a = await adminDb.serviceItem.findFirstOrThrow({ where: { hotelId, externalKey: "ostro-1" } });
    await adminDb.serviceItem.update({ where: { id: a.id }, data: { isActive: false } });
    try {
      const ids = (await listRoomServiceMenu(guest)).flatMap((c) => c.items.map((i) => i.id));
      expect(ids).not.toContain(a.id);
    } finally {
      await adminDb.serviceItem.update({ where: { id: a.id }, data: { isActive: true } });
    }
  });

  it("returns nothing when the stay is not active", async () => {
    const { stay } = await createStay();
    await adminDb.stay.update({ where: { id: stay.id }, data: { status: "CHECKED_OUT", tokenRevokedAt: new Date() } });
    expect(await listRoomServiceMenu({ stayId: stay.id, hotelId })).toEqual([]);
  });
});
