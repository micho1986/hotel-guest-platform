/**
 * Isolates the pg "client.query() ... already executing" warning to the staff queue read.
 * This file runs listQueue alone, so any warning it prints comes from that read.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { listQueue } from "@/server/requests/staff";
import { adminDb, createHotelWithData, createStaffUser } from "./fixtures";

let actor: Actor;
let requestId: string;

beforeAll(async () => {
  const h = await createHotelWithData("queuewarn");
  const user = await createStaffUser(h.hotelId, { email: "emp@queuewarn.test", role: "EMPLOYEE", departmentId: h.dept.id });
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
  await adminDb.request.update({ where: { id: req.id }, data: { status: "RECEIVED" } });
  requestId = req.id;
});

afterAll(async () => {
  await adminDb.$disconnect();
});

describe("listQueue alone", () => {
  it("lists the queue without the pg client.query warning", async () => {
    const warnings: string[] = [];
    const onWarning = (w: Error) => warnings.push(w.message);
    process.on("warning", onWarning);
    try {
      const rows = await listQueue(actor, "new");
      expect(rows.map((r) => r.id)).toContain(requestId);
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("warning", onWarning);
    }
    expect(warnings.filter((m) => m.includes("client.query()"))).toEqual([]);
  });
});
