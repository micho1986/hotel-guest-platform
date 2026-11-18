import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import type { GuestStay } from "@/server/guest";
import { getRequestForStaff } from "@/server/requests/staff";
import { importOstroMenu } from "@/server/room-service/import";
import { placeServiceOrder } from "@/server/room-service/orders";
import { parseOstroMenu } from "@/server/room-service/ostro-menu";
import { adminDb, createHotelWithData, createStaffUser } from "./fixtures";

const menu = parseOstroMenu(readFileSync("prisma/data/ostro-menu.sql", "utf8"));

let hotelId: string;
let fbId: string;
let housekeepingId: string;
let guest: GuestStay;
let fbEmployee: Actor;
let hkEmployee: Actor;
let createStay: (opts?: { checkOutInDays?: number; revoked?: boolean }) => Promise<{ stay: { id: string } }>;

function actorFrom(user: { id: string; name: string; email: string }, departmentId: string): Actor {
  return {
    staffId: user.id,
    hotelId,
    sessionId: "test-session",
    name: user.name,
    email: user.email,
    memberships: [{ role: "EMPLOYEE", departmentId }],
    mfaEnrolled: false,
    mfaVerified: false,
    mustChangePassword: false,
  };
}

beforeAll(async () => {
  const h = await createHotelWithData("rsstaff");
  hotelId = h.hotelId;
  createStay = h.createStay;
  housekeepingId = h.dept.id;
  fbId = (
    await adminDb.department.create({ data: { hotelId, code: "FB", nameEn: "Food & Beverage", nameAr: "الأغذية والمشروبات" } })
  ).id;
  await importOstroMenu(hotelId, menu);
  guest = { stayId: (await createStay()).stay.id, hotelId };
  fbEmployee = actorFrom(
    await createStaffUser(hotelId, { email: "fb1@rsstaff.test", role: "EMPLOYEE", departmentId: fbId }),
    fbId,
  );
  hkEmployee = actorFrom(
    await createStaffUser(hotelId, { email: "hk1@rsstaff.test", role: "EMPLOYEE", departmentId: housekeepingId }),
    housekeepingId,
  );
});

afterAll(async () => {
  await adminDb.$disconnect();
});

describe("staff see the order lines", () => {
  it("a staff member in F&B sees the order's lines and total", async () => {
    const a = await adminDb.serviceItem.findFirstOrThrow({ where: { hotelId, externalKey: "ostro-1" } });
    const b = await adminDb.serviceItem.findFirstOrThrow({ where: { hotelId, externalKey: "ostro-2" } });
    const r = await placeServiceOrder(guest, {
      lines: [
        { serviceItemId: a.id, qty: 2 },
        { serviceItemId: b.id, qty: 1 },
      ],
      guestNote: null,
    });
    expect(r.ok).toBe(true);

    const stored = await adminDb.serviceOrderLine.findMany({ where: { order: { requestId: r.requestId } } });
    expect(stored.map((l) => l.qty).sort()).toEqual([1, 2]);
    const expectedTotal = stored.reduce((sum, l) => sum + Number(l.unitPrice) * l.qty, 0);

    if (!r.requestId) throw new Error("order was not created");
    const detail = await getRequestForStaff(fbEmployee, r.requestId);
    expect(detail?.order?.lines).toHaveLength(2);
    expect(detail?.order?.lines).toEqual(
      expect.arrayContaining(stored.map((l) => expect.objectContaining({ nameSnapshot: l.nameSnapshot, qty: l.qty }))),
    );
    expect(detail?.order?.total).toBeCloseTo(expectedTotal, 2);
  });

  it("a housekeeping employee cannot see the order", async () => {
    const a = await adminDb.serviceItem.findFirstOrThrow({ where: { hotelId, externalKey: "ostro-1" } });
    const r = await placeServiceOrder(guest, { lines: [{ serviceItemId: a.id, qty: 1 }], guestNote: null });
    expect(r.ok).toBe(true);

    if (!r.requestId) throw new Error("order was not created");
    expect(await getRequestForStaff(hkEmployee, r.requestId)).toBeNull();
  });
});
