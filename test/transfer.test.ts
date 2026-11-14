import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { transferRequest } from "@/server/requests/transfer";
import { adminDb, createHotelWithData, createStaffUser } from "./fixtures";

type Role = Actor["memberships"][number]["role"];

let hotelId: string;
let hkId: string;
let engId: string;
let foId: string;
let closedId: string;
let otherHotelDeptId: string;
let createRequest: (stayId: string | null) => Promise<{ id: string }>;
let hkEmployee: Actor;
let engEmployee: Actor;
let gm: Actor;
let hkSupervisor: { id: string };
let engSupervisor: { id: string };
let hotelAdmin: { id: string };

function actorFrom(user: { id: string; name: string; email: string }, role: Role, departmentId: string | null): Actor {
  return {
    staffId: user.id,
    hotelId,
    sessionId: "test-session",
    name: user.name,
    email: user.email,
    memberships: [{ role, departmentId }],
    mfaEnrolled: false,
    mfaVerified: false,
    mustChangePassword: false,
  };
}

beforeAll(async () => {
  const h = await createHotelWithData("transfer");
  hotelId = h.hotelId;
  hkId = h.dept.id;
  createRequest = h.createRequest;
  const dept = (code: string, nameEn: string, isActive = true) =>
    adminDb.department.create({ data: { hotelId, code, nameEn, nameAr: nameEn, isActive } });
  engId = (await dept("ENG", "Engineering")).id;
  foId = (await dept("FO", "Front Office")).id; // no supervisor: alerts go to the hotel admin
  closedId = (await dept("LAUN", "Laundry", false)).id;
  otherHotelDeptId = (await createHotelWithData("transfer-other")).dept.id;

  const u = async (email: string, role: Role, d: string | null) =>
    actorFrom(await createStaffUser(hotelId, { email, role, departmentId: d }), role, d);
  hkEmployee = await u("hk1@transfer.test", "EMPLOYEE", hkId);
  engEmployee = await u("eng1@transfer.test", "EMPLOYEE", engId);
  gm = { ...(await u("gm@transfer.test", "GM", null)), mfaEnrolled: true, mfaVerified: true };
  hkSupervisor = await createStaffUser(hotelId, { email: "hks@transfer.test", role: "SUPERVISOR", departmentId: hkId });
  engSupervisor = await createStaffUser(hotelId, { email: "engs@transfer.test", role: "SUPERVISOR", departmentId: engId });
  hotelAdmin = await createStaffUser(hotelId, { email: "admin@transfer.test", role: "HOTEL_ADMIN" });
});

afterAll(async () => {
  await adminDb.$disconnect();
});

async function requestIn(status: "RECEIVED" | "ACCEPTED" | "IN_PROGRESS" | "COMPLETED", assigneeId: string | null = null) {
  const req = await createRequest(null);
  await adminDb.request.update({
    where: { id: req.id },
    data: { status, assigneeId, acceptedAt: assigneeId ? new Date() : null, departmentId: hkId },
  });
  return req.id;
}

const load = (id: string) => adminDb.request.findUniqueOrThrow({ where: { id } });
const events = (id: string) => adminDb.requestEvent.findMany({ where: { requestId: id } });
const alertsFor = (requestId: string) =>
  adminDb.notification.findMany({ where: { requestId, type: "REQUEST_ALERT" }, select: { recipientStaffId: true } });

describe("transferRequest", () => {
  it("moves an Accepted request to the other department as New, clears the assignee, one event naming both", async () => {
    const id = await requestIn("ACCEPTED", hkEmployee.staffId);

    const result = await transferRequest(hkEmployee, id, engId, "  Leaking tap, not housekeeping  ");

    expect(result.ok).toBe(true);
    const req = await load(id);
    expect(req).toMatchObject({ departmentId: engId, assigneeId: null, acceptedAt: null, status: "RECEIVED" });
    expect(req.transferredAt).toBeInstanceOf(Date);
    const evs = await events(id);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ fromStatus: "ACCEPTED", toStatus: "RECEIVED", actorId: hkEmployee.staffId, isInternal: true });
    expect(evs[0].note).toContain("Housekeeping");
    expect(evs[0].note).toContain("Engineering");
    expect(evs[0].note).toContain("Leaking tap, not housekeeping");
  });

  it("transfers a New request and restarts its alert clock", async () => {
    const id = await requestIn("RECEIVED");
    const result = await transferRequest(hkEmployee, id, engId, "Wrong department");
    expect(result.ok).toBe(true);
    const req = await load(id);
    expect(req.departmentId).toBe(engId);
    expect(req.alertedAt?.getTime()).toBe(req.transferredAt?.getTime());
  });

  it("alerts the receiving department's supervisors, not the sending department's", async () => {
    const id = await requestIn("RECEIVED");
    await transferRequest(hkEmployee, id, engId, "Engineering job");
    const recipients = (await alertsFor(id)).map((n) => n.recipientStaffId);
    expect(recipients).toEqual([engSupervisor.id]);
    expect(recipients).not.toContain(hkSupervisor.id);
  });

  it("alerts the hotel admins when the receiving department has no supervisor", async () => {
    const id = await requestIn("RECEIVED");
    await transferRequest(hkEmployee, id, foId, "Front office will handle it");
    expect((await alertsFor(id)).map((n) => n.recipientStaffId)).toEqual([hotelAdmin.id]);
  });

  it.each(["COMPLETED", "IN_PROGRESS"] as const)("refuses to transfer a %s request (review focus 3)", async (status) => {
    const id = await requestIn(status, hkEmployee.staffId);
    const result = await transferRequest(hkEmployee, id, engId, "Too late");
    expect(result.ok).toBe(false);
    expect((await load(id)).departmentId).toBe(hkId);
    expect(await events(id)).toHaveLength(0);
    expect(await alertsFor(id)).toHaveLength(0);
  });

  it("refuses a blank reason", async () => {
    const id = await requestIn("RECEIVED");
    const result = await transferRequest(hkEmployee, id, engId, "   ");
    expect(result.ok).toBe(false);
    expect((await load(id)).departmentId).toBe(hkId);
  });

  it("refuses the same department, an inactive department, another hotel's department and a malformed id", async () => {
    const id = await requestIn("RECEIVED");
    for (const target of [hkId, closedId, otherHotelDeptId, "not-a-uuid"]) {
      expect((await transferRequest(hkEmployee, id, target, "Move it")).ok).toBe(false);
    }
    expect((await load(id)).departmentId).toBe(hkId);
    expect(await events(id)).toHaveLength(0);
  });

  it("refuses staff outside the request's department, and the GM", async () => {
    const id = await requestIn("RECEIVED");
    expect((await transferRequest(engEmployee, id, engId, "Mine now")).ok).toBe(false);
    expect((await transferRequest(gm, id, engId, "Move it")).ok).toBe(false);
    expect((await load(id)).departmentId).toBe(hkId);
  });

  it("two simultaneous transfers of the same request: exactly one succeeds", async () => {
    const id = await requestIn("RECEIVED");
    const results = await Promise.all([
      transferRequest(hkEmployee, id, engId, "To engineering"),
      transferRequest(hkEmployee, id, foId, "To front office"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await events(id)).toHaveLength(1);
  });
});
