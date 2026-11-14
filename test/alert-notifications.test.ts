import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { countUnreadAlerts, markRequestAlertsRead } from "@/server/requests/notifications";
import { adminDb, createHotelWithData, createStaffUser } from "./fixtures";

let hotelId: string;
let createRequest: (stayId: string | null) => Promise<{ id: string }>;
let supervisor: Actor;
let other: Actor;

function actorFrom(user: { id: string; name: string; email: string; hotelId: string }, departmentId: string): Actor {
  return {
    staffId: user.id,
    hotelId: user.hotelId,
    sessionId: "test-session",
    name: user.name,
    email: user.email,
    memberships: [{ role: "SUPERVISOR", departmentId }],
    mfaEnrolled: false,
    mfaVerified: false,
    mustChangePassword: false,
  };
}

beforeAll(async () => {
  const h = await createHotelWithData("alertcount");
  hotelId = h.hotelId;
  createRequest = h.createRequest;
  supervisor = actorFrom(await createStaffUser(hotelId, { email: "sup@alertcount.test", role: "SUPERVISOR", departmentId: h.dept.id }), h.dept.id);
  other = actorFrom(await createStaffUser(hotelId, { email: "other@alertcount.test", role: "SUPERVISOR", departmentId: h.dept.id }), h.dept.id);
});

afterAll(async () => {
  await adminDb.$disconnect();
});

const alert = (recipientStaffId: string, requestId: string, type = "REQUEST_ALERT") =>
  adminDb.notification.create({ data: { hotelId, recipientStaffId, requestId, type } });

describe("unread alerts", () => {
  it("counts only this staff member's unread request alerts", async () => {
    const a = await createRequest(null);
    const b = await createRequest(null);
    await alert(supervisor.staffId, a.id);
    await alert(supervisor.staffId, b.id);
    await alert(supervisor.staffId, a.id, "REQUEST_REJECTED");
    await alert(other.staffId, a.id);

    expect(await countUnreadAlerts(supervisor)).toBe(2);
    expect(await countUnreadAlerts(other)).toBe(1);
  });

  it("opening a request marks only that request's alerts read, only for the viewer", async () => {
    const c = await createRequest(null);
    await alert(supervisor.staffId, c.id);
    await alert(other.staffId, c.id);
    const before = await countUnreadAlerts(supervisor);

    await markRequestAlertsRead(supervisor, c.id);

    expect(await countUnreadAlerts(supervisor)).toBe(before - 1);
    expect(await adminDb.notification.count({ where: { recipientStaffId: other.staffId, requestId: c.id, readAt: null } })).toBe(1);
  });
});
