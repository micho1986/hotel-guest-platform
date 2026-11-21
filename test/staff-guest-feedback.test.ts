import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { getRequestForStaff } from "@/server/requests/staff";
import { adminDb, createHotelWithData, createStaffUser } from "./fixtures";

let hotelId: string;
let actor: Actor;
let createRequest: (stayId: string | null) => Promise<{ id: string }>;

beforeAll(async () => {
  const h = await createHotelWithData("feedback");
  hotelId = h.hotelId;
  createRequest = h.createRequest;
  const user = await createStaffUser(hotelId, { email: "emp@feedback.test", role: "EMPLOYEE", departmentId: h.dept.id });
  actor = {
    staffId: user.id,
    hotelId,
    sessionId: "test-session",
    name: user.name,
    email: user.email,
    memberships: [{ role: "EMPLOYEE", departmentId: h.dept.id }],
    mfaEnrolled: false,
    mfaVerified: false,
    mustChangePassword: false,
  };
});

afterAll(async () => {
  await adminDb.$disconnect();
});

describe("guest rating on the staff request view", () => {
  it("includes the guest's rating and comment on a rated request", async () => {
    const req = await createRequest(null);
    await adminDb.request.update({ where: { id: req.id }, data: { status: "COMPLETED" } });
    await adminDb.requestFeedback.create({ data: { hotelId, requestId: req.id, rating: 2, comment: "Food was cold" } });
    const r = await getRequestForStaff(actor, req.id);
    expect(r?.feedback).toEqual({ rating: 2, comment: "Food was cold", createdAt: expect.any(Date) });
  });

  it("is null when the guest has not rated the request", async () => {
    const req = await createRequest(null);
    const r = await getRequestForStaff(actor, req.id);
    expect(r?.feedback).toBeNull();
  });
});
