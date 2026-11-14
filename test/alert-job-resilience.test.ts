import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// One hotel's writes fail; the job must still alert every other hotel.
const failing = vi.hoisted(() => ({ hotelId: "" }));
vi.mock("@/server/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/db")>();
  return {
    ...actual,
    tenantTransaction: (async (hotelId: string, fn: Parameters<typeof actual.tenantTransaction>[1]) => {
      if (hotelId === failing.hotelId) throw new Error("simulated deadlock");
      return actual.tenantTransaction(hotelId, fn);
    }) as typeof actual.tenantTransaction,
  };
});

import { runAlertJob } from "@/server/requests/alert-job";
import { adminDb, createHotelWithData, createStaffUser } from "./fixtures";

const MIN = 60_000;

async function dueRequest(h: Awaited<ReturnType<typeof createHotelWithData>>) {
  await createStaffUser(h.hotelId, { email: `sup-${h.hotelId}@resilience.test`, role: "SUPERVISOR", departmentId: h.dept.id });
  const r = await h.createRequest(null);
  await adminDb.request.update({ where: { id: r.id }, data: { status: "RECEIVED", createdAt: new Date(Date.now() - 11 * MIN) } });
  return r.id;
}

let goodRequest: string;
let badRequest: string;

beforeAll(async () => {
  const bad = await createHotelWithData("resilience-bad");
  const good = await createHotelWithData("resilience-good");
  failing.hotelId = bad.hotelId;
  badRequest = await dueRequest(bad);
  goodRequest = await dueRequest(good);
});

afterAll(async () => {
  await adminDb.$disconnect();
});

describe("alert job resilience", () => {
  it("logs a request it cannot alert, counts it as failed, and still alerts the rest", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runAlertJob(new Date(), null);

    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(await adminDb.notification.count({ where: { requestId: goodRequest, type: "REQUEST_ALERT" } })).toBe(1);
    expect(await adminDb.notification.count({ where: { requestId: badRequest } })).toBe(0);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
