import "server-only";
import { resolveStayByTokenHash, tenantDb } from "@/server/db";
import { hashAccessToken } from "@/server/tokens";

/** Everything a guest may touch is keyed by this: one stay in one hotel. */
export type GuestStay = { stayId: string; hotelId: string };

/** Token from a QR code → the stay it unlocks, or null if invalid, revoked or expired. */
export async function resolveGuestToken(token: string): Promise<GuestStay | null> {
  if (!token || token.length > 100) return null;
  return resolveStayByTokenHash(hashAccessToken(token));
}

/** A guest's own requests only — never the room's other stays. */
export function listGuestRequests(guest: GuestStay) {
  return tenantDb(guest.hotelId).request.findMany({
    where: { stayId: guest.stayId },
    orderBy: { createdAt: "desc" },
  });
}

/** One request, only if it belongs to this guest's stay. */
export function getGuestRequest(guest: GuestStay, requestId: string) {
  return tenantDb(guest.hotelId).request.findFirst({
    where: { id: requestId, stayId: guest.stayId },
  });
}
