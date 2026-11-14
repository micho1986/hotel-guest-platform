import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAlertJob } from "@/server/requests/alert-job";
import { adminDb, createHotelWithData, createStaffUser } from "./fixtures";

const MIN = 60_000;
let hotelId: string;
let hkSupervisor: { id: string };
let hotelAdmin: { id: string };
let hkId: string;
let engId: string;
let engRequestId: string;
let roomId: string;
let itemId: string;

async function receivedRequest(departmentId: string, minutesAgo: number, priority: "NORMAL" | "URGENT" = "NORMAL") {
  const r = await adminDb.request.create({
    data: { hotelId, publicRef: `T-${Math.random().toString(36).slice(2, 8)}`, roomId, serviceItemId: itemId, departmentId, qty: 1, priority, status: "RECEIVED" },
  });
  await adminDb.request.update({ where: { id: r.id }, data: { createdAt: new Date(Date.now() - minutesAgo * MIN) } });
  return r.id;
}

beforeAll(async () => {
  const h = await createHotelWithData("alertjob");
  hotelId = h.hotelId;
  hkId = h.dept.id;
  roomId = h.room.id;
  itemId = h.item.id;
  const eng = await adminDb.department.create({ data: { hotelId, code: "ENG", nameEn: "Engineering", nameAr: "الهندسة" } });
  engId = eng.id;
  hkSupervisor = await createStaffUser(hotelId, { email: "sup@alertjob.test", role: "SUPERVISOR", departmentId: hkId });
  hotelAdmin = await createStaffUser(hotelId, { email: "admin@alertjob.test", role: "HOTEL_ADMIN" });
  // Engineering has no supervisor: its alerts must go to the hotel admin.
  engRequestId = await receivedRequest(engId, 11);
});

afterAll(async () => {
  await adminDb.$disconnect();
});

describe("alert job (M4)", () => {
  it("alerts the department supervisor once a request is due, and records the alert", async () => {
    const id = await receivedRequest(hkId, 11);
    await runAlertJob(new Date());
    const rows = await adminDb.notification.findMany({ where: { requestId: id, type: "REQUEST_ALERT" } });
    expect(rows.map((r) => r.recipientStaffId)).toEqual([hkSupervisor.id]);
    const req = await adminDb.request.findUniqueOrThrow({ where: { id } });
    expect(req.alertedAt).not.toBeNull();
    expect(req.escalationLevel).toBe(1);
  });

  it("does not alert twice in the same window", async () => {
    const id = await receivedRequest(hkId, 11);
    const now = new Date();
    await runAlertJob(now);
    await runAlertJob(now);
    expect(await adminDb.notification.count({ where: { requestId: id, type: "REQUEST_ALERT" } })).toBe(1);
  });

  it("falls back to the hotel admin when the department has no supervisor", async () => {
    await runAlertJob(new Date());
    const rows = await adminDb.notification.findMany({ where: { requestId: engRequestId, type: "REQUEST_ALERT" } });
    expect(rows.map((r) => r.recipientStaffId)).toEqual([hotelAdmin.id]);
  });

  it("does not alert a request that is still inside its window", async () => {
    const id = await receivedRequest(hkId, 2);
    await runAlertJob(new Date());
    expect(await adminDb.notification.count({ where: { requestId: id } })).toBe(0);
  });
});
