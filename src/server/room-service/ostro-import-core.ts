import type { Prisma } from "@/generated/prisma/client";
import type { OstroMenu } from "@/server/room-service/ostro-menu";

/** Hidden category holding the one catalogue item every room-service order uses (ruling R3). */
export const ROOM_SERVICE_CATEGORY_KEY = "room-service-orders";
/** The umbrella item routed to Food & Beverage; each order is one request for it (ruling R2). */
export const ROOM_SERVICE_ITEM_KEY = "room-service-order";

const ostroKey = (id: number) => `ostro-${id}`;

/**
 * Writes the Ostro menu into one hotel's catalogue inside the given transaction. Idempotent: rows are
 * matched by key, so a second run updates prices and names instead of duplicating them. Products missing
 * from the file are deactivated, never deleted, so old order lines keep pointing at a real item.
 */
export async function writeOstroMenu(
  tx: Prisma.TransactionClient,
  hotelId: string,
  menu: OstroMenu,
): Promise<{ categories: number; items: number }> {
  const fb = await tx.department.findFirst({ where: { hotelId, code: "FB" }, select: { id: true } });
  if (!fb) throw new Error("This hotel has no Food & Beverage department (code FB).");

  const umbrellaCategory = await tx.serviceCategory.upsert({
    where: { hotelId_key: { hotelId, key: ROOM_SERVICE_CATEGORY_KEY } },
    create: { hotelId, key: ROOM_SERVICE_CATEGORY_KEY, nameEn: "Room service orders", nameAr: "Room service orders", isActive: false },
    update: { isActive: false },
  });
  await tx.serviceItem.upsert({
    where: { hotelId_externalKey: { hotelId, externalKey: ROOM_SERVICE_ITEM_KEY } },
    create: {
      hotelId,
      categoryId: umbrellaCategory.id,
      departmentId: fb.id,
      externalKey: ROOM_SERVICE_ITEM_KEY,
      nameEn: "Room service order",
      nameAr: "Room service order",
      maxQty: 1,
      needsNote: false,
      price: null,
    },
    update: { departmentId: fb.id, maxQty: 1, needsNote: false, isActive: true },
  });

  const categoryIds = new Map<number, string>();
  for (const c of menu.categories) {
    const row = await tx.serviceCategory.upsert({
      where: { hotelId_key: { hotelId, key: ostroKey(c.id) } },
      create: { hotelId, key: ostroKey(c.id), nameEn: c.name, nameAr: c.name, sort: c.sort },
      update: { nameEn: c.name, nameAr: c.name, sort: c.sort, isActive: true },
    });
    categoryIds.set(c.id, row.id);
  }

  for (const p of menu.products) {
    const categoryId = categoryIds.get(p.categoryId);
    if (!categoryId) throw new Error(`Menu item ${p.id} is in unknown category ${p.categoryId}`);
    const description = p.description || null;
    const data = {
      categoryId,
      nameEn: p.name,
      nameAr: p.name,
      descriptionEn: description,
      descriptionAr: description,
      price: p.price,
      isActive: p.available,
    };
    await tx.serviceItem.upsert({
      where: { hotelId_externalKey: { hotelId, externalKey: ostroKey(p.id) } },
      create: { hotelId, departmentId: fb.id, externalKey: ostroKey(p.id), maxQty: 20, ...data },
      update: data,
    });
  }

  await tx.serviceItem.updateMany({
    where: {
      hotelId,
      externalKey: { startsWith: "ostro-" },
      NOT: { externalKey: { in: menu.products.map((p) => ostroKey(p.id)) } },
    },
    data: { isActive: false },
  });

  return { categories: menu.categories.length, items: menu.products.length };
}
