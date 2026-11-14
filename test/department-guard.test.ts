import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Spy on the transition service, keeping its real behaviour, to see what each caller pins.
vi.mock("@/server/requests/transitions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/requests/transitions")>();
  return { ...actual, applyTransition: vi.fn(actual.applyTransition) };
});

import type { Actor } from "@/server/auth/permissions";
import { applyTransition } from "@/server/requests/transitions";
import { acceptRequest } from "@/server/requests/staff";
import { assignRequest, cancelStaffRequest } from "@/server/requests/supervisor";
import { adminDb, createHotelWithData, createStaffUser } from "./fixtures";

/**
 * A transfer moves a request to another department while keeping it RECEIVED with no assignee. A
 * department-A actor whose read happened before the transfer committed would still match on status and
 * assignee alone, so every change made on a department's behalf must also pin that department.
 */
let hotelId: string;
let hkId: string;
let createRequest: (stayId: string | null) => Promise<{ id: string }>;
let supervisor: Actor;
let employee: Actor;

const actor = (id: string, role: "SUPERVISOR" | "EMPLOYEE"): Actor => ({
  staffId: id,
  hotelId,
  sessionId: "s",
  name: role,
  email: `${role}@guard.test`,
  memberships: [{ role, departmentId: hkId }],
  mfaEnrolled: false,
  mfaVerified: false,
  mustChangePassword: false,
});

beforeAll(async () => {
  const h = await createHotelWithData("guard");
  hotelId = h.hotelId;
  hkId = h.dept.id;
  createRequest = h.createRequest;
  supervisor = actor((await createStaffUser(hotelId, { email: "s@guard.test", role: "SUPERVISOR", departmentId: hkId })).id, "SUPERVISOR");
  employee = actor((await createStaffUser(hotelId, { email: "e@guard.test", role: "EMPLOYEE", departmentId: hkId })).id, "EMPLOYEE");
});

afterAll(async () => {
  await adminDb.$disconnect();
});

async function newRequest() {
  const r = await createRequest(null);
  await adminDb.request.update({ where: { id: r.id }, data: { status: "RECEIVED" } });
  return r.id;
}

const lastMatch = () => vi.mocked(applyTransition).mock.calls.at(-1)?.[1].match;

describe("changes pin the request's department", () => {
  it.each([
    ["assign", (id: string) => assignRequest(supervisor, id, employee.staffId, null)],
    ["cancel", (id: string) => cancelStaffRequest(supervisor, id, "Duplicate")],
    ["accept", (id: string) => acceptRequest(employee, id)],
  ] as const)("%s", async (_name, change) => {
    const id = await newRequest();
    expect((await change(id)).ok).toBe(true);
    expect(lastMatch()).toMatchObject({ departmentId: hkId });
  });
});
