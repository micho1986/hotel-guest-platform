import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { acceptRequest, completeRequest, getRequestForStaff, listQueue, rejectRequest, startRequest } from "@/server/requests/staff";
import { adminDb, createHotelWithData, createStaffUser } from "./fixtures";

let hotelId: string;
let hk: { id: string };
let eng: { id: string };
let createRequest: (stayId: string | null) => Promise<{ id: string }>;
let guestName: string;
let hkEmployee: Actor;
let hkEmployee2: Actor;
let engEmployee: Actor;
let gm: Actor;
let hkSupervisor: Actor;

function actorFrom(user: { id: string; name: string; email: string }, role: Actor["memberships"][number]["role"], departmentId: string | null): Actor {
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
  const h = await createHotelWithData("staffreq");
  hotelId = h.hotelId;
  hk = h.dept;
  createRequest = h.createRequest;
  guestName = `Guest staffreq`;
  eng = await adminDb.department.create({ data: { hotelId, code: "ENG", nameEn: "Engineering", nameAr: "الهندسة" } });
  const u = async (email: string, role: Actor["memberships"][number]["role"], dept: string | null) =>
    actorFrom(await createStaffUser(hotelId, { email, role, departmentId: dept }), role, dept);
  hkEmployee = await u("hk1@staffreq.test", "EMPLOYEE", hk.id);
  hkEmployee2 = await u("hk2@staffreq.test", "EMPLOYEE", hk.id);
  engEmployee = await u("eng1@staffreq.test", "EMPLOYEE", eng.id);
  hkSupervisor = await u("hks@staffreq.test", "SUPERVISOR", hk.id);
  gm = { ...(await u("gm@staffreq.test", "GM", null)), mfaEnrolled: true, mfaVerified: true }; // GMs must complete MFA
});

afterAll(async () => {
  await adminDb.$disconnect();
});

async function receivedRequest(deptId: string = hk.id) {
  const req = await createRequest(null);
  await adminDb.request.update({ where: { id: req.id }, data: { status: "RECEIVED", departmentId: deptId } });
  return req;
}

describe("queue scope (S1)", () => {
  it("an employee lists only their department; the GM lists every department", async () => {
    const hkReq = await receivedRequest(hk.id);
    const engReq = await receivedRequest(eng.id);

    const hkQueue = await listQueue(hkEmployee, "new");
    const hkIds = hkQueue.map((r) => r.id);
    expect(hkIds).toContain(hkReq.id);
    expect(hkIds).not.toContain(engReq.id);

    const gmIds = (await listQueue(gm, "new")).map((r) => r.id);
    expect(gmIds).toEqual(expect.arrayContaining([hkReq.id, engReq.id]));
  });
});

describe("detail never shows the guest name (T6)", () => {
  it("the employee's view has no guest name in it", async () => {
    const req = await receivedRequest(hk.id);
    const detail = await getRequestForStaff(hkEmployee, req.id);
    expect(detail).not.toBeNull();
    expect(JSON.stringify(detail)).not.toContain(guestName);
    expect(JSON.stringify(detail)).not.toContain("guestDisplayName");
  });
});

describe("actions", () => {
  it("refuses a rejection with only spaces as the reason, and writes nothing (Review Focus 3)", async () => {
    const req = await receivedRequest(hk.id);
    const before = await adminDb.requestEvent.count({ where: { requestId: req.id } });
    const r = await rejectRequest(hkEmployee, req.id, "    ");
    expect(r.ok).toBe(false);
    expect(await adminDb.requestEvent.count({ where: { requestId: req.id } })).toBe(before);
  });

  it("refuses an action from an employee in another department", async () => {
    const req = await receivedRequest(hk.id);
    const r = await acceptRequest(engEmployee, req.id);
    expect(r.ok).toBe(false);
    const row = await adminDb.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(row.status).toBe("RECEIVED");
    expect(row.assigneeId).toBeNull();
  });

  it("accept sets the assignee and time; a second accept says the request has changed", async () => {
    const req = await receivedRequest(hk.id);
    const first = await acceptRequest(hkEmployee, req.id);
    expect(first.ok).toBe(true);
    const row = await adminDb.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(row.status).toBe("ACCEPTED");
    expect(row.assigneeId).toBe(hkEmployee.staffId);
    expect(row.acceptedAt).not.toBeNull();

    const second = await acceptRequest(hkEmployee2, req.id);
    expect(second).toEqual({ ok: false, message: "This request has already changed." });
  });

  it("reject with a reason returns the request to the queue and notifies each supervisor in the department", async () => {
    const req = await receivedRequest(hk.id);
    const r = await rejectRequest(hkEmployee, req.id, "Towels already sent to the room");
    expect(r.ok).toBe(true);
    const row = await adminDb.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(row.status).toBe("RECEIVED");
    const event = await adminDb.requestEvent.findFirstOrThrow({ where: { requestId: req.id }, orderBy: { createdAt: "desc" } });
    expect(event.note).toBe("Towels already sent to the room");
    const notes = await adminDb.notification.findMany({ where: { requestId: req.id, type: "REQUEST_REJECTED" } });
    expect(notes.map((n) => n.recipientStaffId)).toEqual([hkSupervisor.staffId]);
  });
});

describe("assignee rule", () => {
  it("only the person who accepted can start and complete; the assignee can complete", async () => {
    const req = await receivedRequest(hk.id);
    expect((await acceptRequest(hkEmployee, req.id)).ok).toBe(true);
    const notMine = await startRequest(hkSupervisor, req.id);
    expect(notMine).toEqual({ ok: false, message: "Only the person who accepted this request can do that." });
    expect((await startRequest(hkEmployee, req.id)).ok).toBe(true);
    expect((await completeRequest(hkEmployee, req.id)).ok).toBe(true);
    const row = await adminDb.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(row.status).toBe("COMPLETED");
    expect(row.completedAt).not.toBeNull();
  });
});
