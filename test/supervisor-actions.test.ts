import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { assignRequest, cancelStaffRequest, listAssignableStaff, reassignRequest } from "@/server/requests/supervisor";
import { adminDb, createHotelWithData, createStaffUser } from "./fixtures";

type Role = Actor["memberships"][number]["role"];

let hotelId: string;
let hkId: string;
let engId: string;
let createRequest: (stayId: string | null) => Promise<{ id: string }>;
let hkSupervisor: Actor;
let hkSupervisor2: Actor;
let engSupervisor: Actor;
let hkEmployee: Actor;
let hkEmployee2: Actor;
let engEmployee: Actor;
let gm: Actor;

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
  const h = await createHotelWithData("supervisor");
  hotelId = h.hotelId;
  hkId = h.dept.id;
  createRequest = h.createRequest;
  const eng = await adminDb.department.create({ data: { hotelId, code: "ENG", nameEn: "Engineering", nameAr: "الهندسة" } });
  engId = eng.id;
  const u = async (email: string, role: Role, dept: string | null) =>
    actorFrom(await createStaffUser(hotelId, { email, role, departmentId: dept }), role, dept);
  hkSupervisor = await u("hks@supervisor.test", "SUPERVISOR", hkId);
  hkSupervisor2 = await u("hks2@supervisor.test", "SUPERVISOR", hkId);
  engSupervisor = await u("engs@supervisor.test", "SUPERVISOR", engId);
  hkEmployee = await u("hk1@supervisor.test", "EMPLOYEE", hkId);
  hkEmployee2 = await u("hk2@supervisor.test", "EMPLOYEE", hkId);
  engEmployee = await u("eng1@supervisor.test", "EMPLOYEE", engId);
  gm = { ...(await u("gm@supervisor.test", "GM", null)), mfaEnrolled: true, mfaVerified: true };
});

afterAll(async () => {
  await adminDb.$disconnect();
});

async function requestIn(status: "RECEIVED" | "ACCEPTED" | "IN_PROGRESS" | "COMPLETED", assigneeId: string | null = null) {
  const req = await createRequest(null);
  await adminDb.request.update({ where: { id: req.id }, data: { status, assigneeId } });
  return req.id;
}

const load = (id: string) => adminDb.request.findUniqueOrThrow({ where: { id } });
const events = (id: string) => adminDb.requestEvent.findMany({ where: { requestId: id }, orderBy: { createdAt: "asc" } });

describe("assignRequest", () => {
  it("sets the assignee on a New request, keeps it New, and writes one event naming the staff member", async () => {
    const id = await requestIn("RECEIVED");

    const result = await assignRequest(hkSupervisor, id, hkEmployee.staffId);

    expect(result.ok).toBe(true);
    const req = await load(id);
    expect(req.assigneeId).toBe(hkEmployee.staffId);
    expect(req.status).toBe("RECEIVED");
    const evs = await events(id);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ fromStatus: "RECEIVED", toStatus: "RECEIVED", actorId: hkSupervisor.staffId, isInternal: true });
    expect(evs[0].note).toContain(hkEmployee.name);
  });

  it("refuses a request that already has an assignee (use reassign)", async () => {
    const id = await requestIn("ACCEPTED", hkEmployee.staffId);
    const result = await assignRequest(hkSupervisor, id, hkEmployee2.staffId);
    expect(result.ok).toBe(false);
    expect((await load(id)).assigneeId).toBe(hkEmployee.staffId);
    expect(await events(id)).toHaveLength(0);
  });
});

describe("reassignRequest", () => {
  it("moves an Accepted request to another member of the same department, one event", async () => {
    const id = await requestIn("ACCEPTED", hkEmployee.staffId);

    const result = await reassignRequest(hkSupervisor, id, hkEmployee2.staffId);

    expect(result.ok).toBe(true);
    const req = await load(id);
    expect(req.assigneeId).toBe(hkEmployee2.staffId);
    expect(req.status).toBe("ACCEPTED");
    const evs = await events(id);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ fromStatus: "ACCEPTED", toStatus: "ACCEPTED" });
    expect(evs[0].note).toContain(hkEmployee2.name);
  });

  it("refuses an In progress request", async () => {
    const id = await requestIn("IN_PROGRESS", hkEmployee.staffId);
    const result = await reassignRequest(hkSupervisor, id, hkEmployee2.staffId);
    expect(result.ok).toBe(false);
    expect((await load(id)).assigneeId).toBe(hkEmployee.staffId);
  });

  // Promise.all does not force the two reads to overlap, so both target the same person: overlapping, the
  // match guard refuses the loser; sequential, the second finds it "already with" them. Either way, one wins.
  // The guard itself under true overlap is covered in transitions.test.ts.
  it("two supervisors reassigning at once: exactly one succeeds (spec review focus 1)", async () => {
    const id = await requestIn("ACCEPTED", hkEmployee.staffId);

    const results = await Promise.all([
      reassignRequest(hkSupervisor, id, hkEmployee2.staffId),
      reassignRequest(hkSupervisor2, id, hkEmployee2.staffId),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await events(id)).toHaveLength(1);
  });
});

describe("cancelStaffRequest", () => {
  it.each(["RECEIVED", "ACCEPTED"] as const)("cancels from %s with the reason as an internal note", async (status) => {
    const id = await requestIn(status, status === "ACCEPTED" ? hkEmployee.staffId : null);

    const result = await cancelStaffRequest(hkSupervisor, id, "  Guest asked at the desk  ");

    expect(result.ok).toBe(true);
    expect((await load(id)).status).toBe("CANCELLED");
    const evs = await events(id);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ fromStatus: status, toStatus: "CANCELLED", note: "Guest asked at the desk", isInternal: true });
  });

  it.each(["IN_PROGRESS", "COMPLETED"] as const)("refuses to cancel from %s", async (status) => {
    const id = await requestIn(status, hkEmployee.staffId);
    const result = await cancelStaffRequest(hkSupervisor, id, "No longer needed");
    expect(result.ok).toBe(false);
    expect((await load(id)).status).toBe(status);
  });

  it("refuses a blank reason", async () => {
    const id = await requestIn("RECEIVED");
    const result = await cancelStaffRequest(hkSupervisor, id, "   ");
    expect(result.ok).toBe(false);
    expect((await load(id)).status).toBe("RECEIVED");
  });
});

describe("who may act", () => {
  it("a supervisor of another department is refused (review focus 2)", async () => {
    const id = await requestIn("RECEIVED");
    expect((await assignRequest(engSupervisor, id, hkEmployee.staffId)).ok).toBe(false);
    expect((await cancelStaffRequest(engSupervisor, id, "Wrong department")).ok).toBe(false);
    const accepted = await requestIn("ACCEPTED", hkEmployee.staffId);
    expect((await reassignRequest(engSupervisor, accepted, hkEmployee2.staffId)).ok).toBe(false);
    expect((await load(id)).assigneeId).toBeNull();
    expect(await events(id)).toHaveLength(0);
  });

  it("a staff member who is not a supervisor is refused", async () => {
    const id = await requestIn("RECEIVED");
    expect((await assignRequest(hkEmployee, id, hkEmployee2.staffId)).ok).toBe(false);
    expect((await cancelStaffRequest(hkEmployee, id, "Not mine")).ok).toBe(false);
    expect((await load(id)).status).toBe("RECEIVED");
  });

  it("the GM is read-only and is refused", async () => {
    const id = await requestIn("RECEIVED");
    expect((await assignRequest(gm, id, hkEmployee.staffId)).ok).toBe(false);
    expect((await load(id)).assigneeId).toBeNull();
  });

  it("the assignee must belong to the request's department", async () => {
    const id = await requestIn("RECEIVED");
    expect((await assignRequest(hkSupervisor, id, engEmployee.staffId)).ok).toBe(false);
    const accepted = await requestIn("ACCEPTED", hkEmployee.staffId);
    expect((await reassignRequest(hkSupervisor, accepted, engEmployee.staffId)).ok).toBe(false);
    expect((await load(id)).assigneeId).toBeNull();
    expect((await load(accepted)).assigneeId).toBe(hkEmployee.staffId);
  });

  it("refuses a malformed request id", async () => {
    expect((await assignRequest(hkSupervisor, "not-a-uuid", hkEmployee.staffId)).ok).toBe(false);
  });
});

describe("listAssignableStaff", () => {
  it("lists the department's active employees and supervisors for its supervisor, by name", async () => {
    const people = await listAssignableStaff(hkSupervisor, hkId);
    const ids = people.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([hkEmployee.staffId, hkEmployee2.staffId, hkSupervisor.staffId, hkSupervisor2.staffId]));
    expect(ids).not.toContain(engEmployee.staffId);
    expect(people.find((p) => p.id === hkEmployee.staffId)?.name).toBe(hkEmployee.name);
  });

  it("returns nobody to a supervisor of another department, an employee or the GM", async () => {
    expect(await listAssignableStaff(engSupervisor, hkId)).toEqual([]);
    expect(await listAssignableStaff(hkEmployee, hkId)).toEqual([]);
    expect(await listAssignableStaff(gm, hkId)).toEqual([]);
  });
});
