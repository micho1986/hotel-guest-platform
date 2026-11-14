import "server-only";
import { resolveStayByTokenHash, tenantDb } from "@/server/db";
import { hashAccessToken } from "@/server/tokens";

/** Everything a guest may touch is keyed by this: one stay in one hotel. */
export type GuestStay = { stayId: string; hotelId: string };

const TOKEN_PATH_RE = /^[A-Za-z0-9_-]{1,100}$/;

/** A token from the URL path, or null if it cannot be a token (checked before any database call). */
export function guestTokenFromParams(token: string): string | null {
  return TOKEN_PATH_RE.test(token) ? token : null;
}

/** Token from a QR code → the stay it unlocks, or null if invalid, revoked or expired. */
export async function resolveGuestToken(token: string): Promise<GuestStay | null> {
  if (!token || token.length > 100) return null;
  return resolveStayByTokenHash(hashAccessToken(token));
}

/** Active categories with their active, non-deleted items, in display order. */
export function listGuestCategories(guest: GuestStay) {
  return tenantDb(guest.hotelId).serviceCategory.findMany({
    where: { isActive: true },
    orderBy: { sort: "asc" },
    include: { items: { where: { isActive: true, deletedAt: null }, orderBy: { nameEn: "asc" } } },
  });
}

/** One orderable item, or null if it is inactive, deleted or belongs to another hotel. */
export function getGuestItem(guest: GuestStay, itemId: string) {
  return tenantDb(guest.hotelId).serviceItem.findFirst({
    where: { id: itemId, isActive: true, deletedAt: null },
    include: { category: true },
  });
}

/** A guest's own requests only — never the room's other stays. */
export function listGuestRequests(guest: GuestStay) {
  return tenantDb(guest.hotelId).request.findMany({
    where: { stayId: guest.stayId },
    orderBy: { createdAt: "desc" },
    include: { serviceItem: { select: { nameEn: true, nameAr: true } } },
  });
}

/** One request, only if it belongs to this guest's stay. */
export function getGuestRequest(guest: GuestStay, requestId: string) {
  return tenantDb(guest.hotelId).request.findFirst({
    where: { id: requestId, stayId: guest.stayId },
  });
}
