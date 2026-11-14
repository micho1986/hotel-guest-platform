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

/** A request in the given status (the fixture creates them SUBMITTED). */
async function requestIn(status: "RECEIVED" | "ACCEPTED" | "IN_PROGRESS") {
  const r = await createRequest(null);
  await adminDb.request.update({ where: { id: r.id }, data: { status } });
  return r;
}

const alert = (recipientStaffId: string, requestId: string, type = "REQUEST_ALERT") =>
  adminDb.notification.create({ data: { hotelId, recipientStaffId, requestId, type } });

describe("unread alerts", () => {
  it("counts only this staff member's unread request alerts", async () => {
    const a = await requestIn("RECEIVED");
    const b = await requestIn("RECEIVED");
    await alert(supervisor.staffId, a.id);
    await alert(supervisor.staffId, b.id);
    await alert(supervisor.staffId, a.id, "REQUEST_REJECTED");
    await alert(other.staffId, a.id);

    const mine = await countUnreadAlerts(supervisor);
    expect(mine).toBe(2);
    expect(await countUnreadAlerts(other)).toBeGreaterThanOrEqual(1);
  });

  it("opening a request marks only that request's alerts read, only for the viewer", async () => {
    const c = await requestIn("RECEIVED");
    await alert(supervisor.staffId, c.id);
    await alert(other.staffId, c.id);
    const before = await countUnreadAlerts(supervisor);

    await markRequestAlertsRead(supervisor, c.id);

    expect(await countUnreadAlerts(supervisor)).toBe(before - 1);
    expect(await adminDb.notification.count({ where: { recipientStaffId: other.staffId, requestId: c.id, readAt: null } })).toBe(1);
  });
});

describe("what counts as waiting", () => {
  it("counts a request once however many alerts it has", async () => {
    const actor = { ...supervisor, staffId: (await createStaffUser(hotelId, { email: "once@alertcount.test", role: "SUPERVISOR" })).id };
    const r = await requestIn("RECEIVED");
    await alert(actor.staffId, r.id);
    await alert(actor.staffId, r.id);
    expect(await countUnreadAlerts(actor)).toBe(1);
  });

  it("stops counting an alert once its request is no longer New", async () => {
    const actor = { ...supervisor, staffId: (await createStaffUser(hotelId, { email: "moved@alertcount.test", role: "SUPERVISOR" })).id };
    const r = await requestIn("RECEIVED");
    await alert(actor.staffId, r.id);
    await adminDb.request.update({ where: { id: r.id }, data: { status: "IN_PROGRESS" } });
    expect(await countUnreadAlerts(actor)).toBe(0);
  });

  it("counts an assignment while the request is New or Accepted", async () => {
    const actor = { ...supervisor, staffId: (await createStaffUser(hotelId, { email: "given@alertcount.test", role: "EMPLOYEE" })).id };
    const r = await requestIn("ACCEPTED");
    await alert(actor.staffId, r.id, "REQUEST_ASSIGNED");
    expect(await countUnreadAlerts(actor)).toBe(1);
    await adminDb.request.update({ where: { id: r.id }, data: { status: "IN_PROGRESS" } });
    expect(await countUnreadAlerts(actor)).toBe(0);
  });
});
