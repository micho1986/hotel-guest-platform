import "server-only";
import { tenantDb } from "@/server/db";
import type { GuestStay } from "@/server/guest";

export type RoomServiceMenu = {
  key: string;
  nameEn: string;
  items: { id: string; nameEn: string; descriptionEn: string | null; price: number }[];
}[];

/**
 * The Ostro menu as a guest sees it: active Ostro categories and their active items, and nothing at all
 * for a stay that is not active. Items are ordered by name, because the catalogue keeps no sort order
 * for them (ruling R6 in the plan).
 */
export async function listRoomServiceMenu(guest: GuestStay): Promise<RoomServiceMenu> {
  const db = tenantDb(guest.hotelId);
  const stay = await db.stay.findFirst({ where: { id: guest.stayId }, select: { status: true, tokenRevokedAt: true } });
  if (!stay || stay.status !== "ACTIVE" || stay.tokenRevokedAt) return [];

  const categories = await db.serviceCategory.findMany({
    where: { isActive: true, key: { startsWith: "ostro-" } },
    orderBy: { sort: "asc" },
    include: {
      items: {
        where: { isActive: true, deletedAt: null, externalKey: { startsWith: "ostro-" } },
        orderBy: { nameEn: "asc" },
        select: { id: true, nameEn: true, descriptionEn: true, price: true },
      },
    },
  });

  return categories.map((c) => ({
    key: c.key,
    nameEn: c.nameEn,
    items: c.items.flatMap((i) =>
      i.price === null ? [] : [{ id: i.id, nameEn: i.nameEn, descriptionEn: i.descriptionEn, price: Number(i.price) }],
    ),
  }));
}
