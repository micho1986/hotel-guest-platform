import "server-only";
import type { Actor } from "@/server/auth/permissions";
import { tenantDb } from "@/server/db";
import { isUuid } from "@/server/ids";

/** Alerts written by the alert job and by transfers (M4). */
const ALERT_TYPE = "REQUEST_ALERT";

/** How many request alerts this staff member has not opened yet. The queue plays a sound when it rises. */
export async function countUnreadAlerts(actor: Actor): Promise<number> {
  return tenantDb(actor.hotelId).notification.count({
    where: { recipientStaffId: actor.staffId, type: ALERT_TYPE, readAt: null },
  });
}

/** Opening a request clears the viewer's alerts for it; other recipients keep theirs. */
export async function markRequestAlertsRead(actor: Actor, requestId: string): Promise<void> {
  if (!isUuid(requestId)) return;
  await tenantDb(actor.hotelId).notification.updateMany({
    where: { recipientStaffId: actor.staffId, requestId, type: ALERT_TYPE, readAt: null },
    data: { readAt: new Date() },
  });
}
