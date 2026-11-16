import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importOstroMenu, ROOM_SERVICE_CATEGORY_KEY, ROOM_SERVICE_ITEM_KEY } from "@/server/room-service/import";
import { parseOstroMenu } from "@/server/room-service/ostro-menu";
import { adminDb, createHotelWithData } from "./fixtures";

const menu = parseOstroMenu(readFileSync("prisma/data/ostro-menu.sql", "utf8"));
let hotelId: string;

beforeAll(async () => {
  const h = await createHotelWithData("rs-import");
  hotelId = h.hotelId;
  await adminDb.department.create({ data: { hotelId, code: "FB", nameEn: "Food & Beverage", nameAr: "الأغذية والمشروبات" } });
});

afterAll(async () => {
  await adminDb.$disconnect();
});

describe("importOstroMenu", () => {
  it("creates 17 categories and 127 items plus the hidden umbrella item", async () => {
    await importOstroMenu(hotelId, menu);
    expect(await adminDb.serviceCategory.count({ where: { hotelId, key: { startsWith: "ostro-" } } })).toBe(17);
    expect(await adminDb.serviceItem.count({ where: { hotelId, externalKey: { startsWith: "ostro-" } } })).toBe(127);
  });

  it("is idempotent: a second run creates no duplicates", async () => {
    await importOstroMenu(hotelId, menu);
    expect(await adminDb.serviceItem.count({ where: { hotelId, externalKey: { startsWith: "ostro-" } } })).toBe(127);
  });

  it("uses the Ostro name and price unchanged, with the English name as the Arabic placeholder", async () => {
    const item = await adminDb.serviceItem.findFirstOrThrow({ where: { hotelId, externalKey: "ostro-1" } });
    expect(item).toMatchObject({ nameEn: "Poached Eggs on Toast", nameAr: "Poached Eggs on Toast", isActive: true });
    expect(Number(item.price)).toBe(59);
  });

  it("a changed Ostro price updates the item; a product removed from the file is deactivated, not deleted", async () => {
    const changed = {
      ...menu,
      products: menu.products.map((p) => (p.id === 1 ? { ...p, price: 65 } : p)).filter((p) => p.id !== 2),
    };
    await importOstroMenu(hotelId, changed);
    expect(Number((await adminDb.serviceItem.findFirstOrThrow({ where: { hotelId, externalKey: "ostro-1" } })).price)).toBe(65);
    const gone = await adminDb.serviceItem.findFirstOrThrow({ where: { hotelId, externalKey: "ostro-2" } });
    expect(gone.isActive).toBe(false);
    await importOstroMenu(hotelId, menu);
  });

  it("the umbrella item routes to Food & Beverage and its category is hidden from guests", async () => {
    const umbrella = await adminDb.serviceItem.findFirstOrThrow({ where: { hotelId, externalKey: ROOM_SERVICE_ITEM_KEY } });
    const fb = await adminDb.department.findFirstOrThrow({ where: { hotelId, code: "FB" } });
    expect(umbrella).toMatchObject({ departmentId: fb.id, maxQty: 1, needsNote: false });
    const cat = await adminDb.serviceCategory.findFirstOrThrow({ where: { hotelId, key: ROOM_SERVICE_CATEGORY_KEY } });
    expect(cat.isActive).toBe(false);
  });
});
