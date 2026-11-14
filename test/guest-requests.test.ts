import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getGuestRequest, listGuestCategories, type GuestStay } from "@/server/guest";
import { submitGuestRequest } from "@/server/guest-requests";
import { adminDb, createHotelWithData } from "./fixtures";

let hotelId: string;
let hkId: string;
let towelsId: string;
let conciergeItemId: string;
let guest: GuestStay;
let otherGuest: GuestStay;
let createStay: (opts?: { checkOutInDays?: number; revoked?: boolean }) => Promise<{ stay: { id: string } }>;

beforeAll(async () => {
  const h = await createHotelWithData("guestreq");
  hotelId = h.hotelId;
  hkId = h.dept.id;
  towelsId = h.item.id;
  createStay = h.createStay;

  const conc = await adminDb.department.create({ data: { hotelId, code: "CONC", nameEn: "Concierge", nameAr: "الكونسيرج" } });
  const cat = await adminDb.serviceCategory.create({ data: { hotelId, key: "concierge", nameEn: "Concierge", nameAr: "الكونسيرج" } });
  const ci = await adminDb.serviceItem.create({
    data: { hotelId, categoryId: cat.id, departmentId: conc.id, nameEn: "Ask the concierge", nameAr: "اسأل الكونسيرج", needsNote: true, maxQty: 1 },
  });
  conciergeItemId = ci.id;

  guest = { stayId: (await createStay()).stay.id, hotelId };
  otherGuest = { stayId: (await createStay()).stay.id, hotelId };
});

afterAll(async () => {
  await adminDb.$disconnect();
});

describe("guest requests", () => {
  it("submits a catalogue request routed to the item's department", async () => {
    const r = await submitGuestRequest(guest, { serviceItemId: towelsId, qty: 2, guestNote: null });
    expect(r.ok).toBe(true);
    const row = await adminDb.request.findFirstOrThrow({ where: { id: r.requestId } });
    expect(row.departmentId).toBe(hkId);
    expect(row.status).toBe("RECEIVED"); // M3 D5: routed to Received on submit
  });

  it("rejects quantity above maxQty without writing", async () => {
    const before = await adminDb.request.count({ where: { stayId: guest.stayId } });
    const tooMany = await submitGuestRequest(guest, { serviceItemId: towelsId, qty: 99, guestNote: null });
    const zero = await submitGuestRequest(guest, { serviceItemId: towelsId, qty: 0, guestNote: null });
    expect(tooMany.ok).toBe(false);
    expect(zero.ok).toBe(false);
    expect(await adminDb.request.count({ where: { stayId: guest.stayId } })).toBe(before);
  });

  it("rejects a concierge request with a blank note", async () => {
    const r = await submitGuestRequest(guest, { serviceItemId: conciergeItemId, qty: 1, guestNote: "   " });
    expect(r.ok).toBe(false);
    expect(r.message).toBe("Please describe your request.");
  });

  it("refuses submission after check-out", async () => {
    const { stay } = await createStay();
    await adminDb.stay.update({ where: { id: stay.id }, data: { status: "CHECKED_OUT", tokenRevokedAt: new Date() } });
    const r = await submitGuestRequest({ stayId: stay.id, hotelId }, { serviceItemId: towelsId, qty: 1, guestNote: null });
    expect(r.ok).toBe(false);
    expect(r.message).toBe("This link is no longer active.");
  });

  it("guest cannot read another stay's request", async () => {
    const other = await submitGuestRequest(otherGuest, { serviceItemId: towelsId, qty: 1, guestNote: null });
    expect(other.ok).toBe(true);
    expect(await getGuestRequest(guest, other.requestId!)).toBeNull();
  });

  it("lists only active categories and active, non-deleted items", async () => {
    await adminDb.serviceItem.create({
      data: { hotelId, categoryId: (await adminDb.serviceCategory.findFirstOrThrow({ where: { hotelId, key: "amenities" } })).id, departmentId: hkId, nameEn: "Retired", nameAr: "متقاعد", isActive: false },
    });
    const cats = await listGuestCategories(guest);
    const names = cats.flatMap((c) => c.items.map((i) => i.nameEn));
    expect(names).toContain("Extra towels");
    expect(names).not.toContain("Retired");
  });
});

describe("routing on submit (M3)", () => {
  it("leaves a submitted request Received, with a guest event then a system event", async () => {
    const r = await submitGuestRequest(guest, { serviceItemId: towelsId, qty: 1, guestNote: null });
    expect(r.ok).toBe(true);
    const row = await adminDb.request.findUniqueOrThrow({ where: { id: r.requestId } });
    expect(row.status).toBe("RECEIVED");
    const events = await adminDb.requestEvent.findMany({ where: { requestId: r.requestId }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => [e.actorType, e.fromStatus, e.toStatus])).toEqual([
      ["GUEST", null, "SUBMITTED"],
      ["SYSTEM", "SUBMITTED", "RECEIVED"],
    ]);
  });
});
