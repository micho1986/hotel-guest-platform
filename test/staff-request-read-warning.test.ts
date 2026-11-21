/**
 * Isolates the pg "client.query() ... already executing" warning to one read.
 * getRequestForStaff selects many relations in one findFirst inside a tenant transaction.
 * This file runs that read alone, so any warning it prints comes from that read.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { getRequestForStaff } from "@/server/requests/staff";
import { adminDb, createHotelWithData, createStaffUser } from "./fixtures";

let actor: Actor;
let requestId: string;

beforeAll(async () => {
  const h = await createHotelWithData("readwarn");
  const user = await createStaffUser(h.hotelId, { email: "emp@readwarn.test", role: "EMPLOYEE", departmentId: h.dept.id });
  actor = {
    staffId: user.id,
    hotelId: h.hotelId,
    sessionId: "test-session",
    name: user.name,
    email: user.email,
    memberships: [{ role: "EMPLOYEE", departmentId: h.dept.id }],
    mfaEnrolled: false,
    mfaVerified: false,
    mustChangePassword: false,
  };
  const req = await h.createRequest(null);
  requestId = req.id;
});

afterAll(async () => {
  await adminDb.$disconnect();
});

describe("getRequestForStaff alone", () => {
  it("reads one request without the pg client.query warning", async () => {
    const warnings: string[] = [];
    const onWarning = (w: Error) => warnings.push(w.message);
    process.on("warning", onWarning);
    try {
      const r = await getRequestForStaff(actor, requestId);
      expect(r?.id).toBe(requestId);
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("warning", onWarning);
    }
    expect(warnings.filter((m) => m.includes("client.query()"))).toEqual([]);
  });
});
