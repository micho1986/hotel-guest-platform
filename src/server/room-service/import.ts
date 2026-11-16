import "server-only";
import { tenantTransaction } from "@/server/db";
import { writeOstroMenu } from "@/server/room-service/ostro-import-core";
import type { OstroMenu } from "@/server/room-service/ostro-menu";

export { ROOM_SERVICE_CATEGORY_KEY, ROOM_SERVICE_ITEM_KEY } from "@/server/room-service/ostro-import-core";

/** App-side import for one hotel, run inside that hotel's tenant transaction. */
export function importOstroMenu(hotelId: string, menu: OstroMenu): Promise<{ categories: number; items: number }> {
  return tenantTransaction(hotelId, (tx) => writeOstroMenu(tx, hotelId, menu));
}
