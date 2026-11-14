import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GuestStay } from "@/server/guest";
import { cancelGuestRequest, rateGuestRequest } from "@/server/guest-requests";
import { adminDb, createHotelWithData } from "./fixtures";

let hotelId: string;
let guest: GuestStay;
let otherGuest: GuestStay;
let createRequest: (stayId: string | null) => Promise<{ id: string }>;
let createStay: () => Promise<{ stay: { id: string } }>;

beforeAll(async () => {
  const h = await createHotelWithData("guestfb");
  hotelId = h.hotelId;
  createRequest = h.createRequest;
  createStay = h.createStay;
  guest = { stayId: (await createStay()).stay.id, hotelId };
  otherGuest = { stayId: (await createStay()).stay.id, hotelId };
});
afterAll(async () => {
  await adminDb.$disconnect();
});

async function requestIn(status: string, stayId = guest.stayId) {
  const req = await createRequest(stayId);
  await adminDb.request.update({ where: { id: req.id }, data: { status: status as never } });
  return req.id;
}

describe("guest cancel (G4)", () => {
  it("cancels a request that has not been accepted, with a guest event", async () => {
    const id = await requestIn("RECEIVED");
    const r = await cancelGuestRequest(guest, id);
    expect(r.ok).toBe(true);
    expect((await adminDb.request.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELLED");
    const last = await adminDb.requestEvent.findFirstOrThrow({ where: { requestId: id }, orderBy: { createdAt: "desc" } });
    expect([last.actorType, last.fromStatus, last.toStatus]).toEqual(["GUEST", "RECEIVED", "CANCELLED"]);
  });

  it("refuses to cancel once accepted", async () => {
    const id = await requestIn("ACCEPTED");
    const r = await cancelGuestRequest(guest, id);
    expect(r.ok).toBe(false);
    expect((await adminDb.request.findUniqueOrThrow({ where: { id } })).status).toBe("ACCEPTED");
  });
});

describe("guest rating (G5)", () => {
  it("refuses to rate a request that is still in progress (Review Focus 4)", async () => {
    const id = await requestIn("IN_PROGRESS");
    const r = await rateGuestRequest(guest, id, { rating: 5, comment: null });
    expect(r.ok).toBe(false);
    expect(await adminDb.requestFeedback.count({ where: { requestId: id } })).toBe(0);
  });

  it("accepts one rating after completion and refuses a second (Review Focus 4)", async () => {
    const id = await requestIn("COMPLETED");
    expect((await rateGuestRequest(guest, id, { rating: 4, comment: "Quick, thank you" })).ok).toBe(true);
    const again = await rateGuestRequest(guest, id, { rating: 1, comment: null });
    expect(again.ok).toBe(false);
    const rows = await adminDb.requestFeedback.findMany({ where: { requestId: id } });
    expect(rows.map((r) => r.rating)).toEqual([4]);
  });

  it("refuses an out-of-range rating", async () => {
    const id = await requestIn("COMPLETED");
    expect((await rateGuestRequest(guest, id, { rating: 6, comment: null })).ok).toBe(false);
    expect((await rateGuestRequest(guest, id, { rating: 0, comment: null })).ok).toBe(false);
  });
});

describe("another stay's guest (T3)", () => {
  it("cannot cancel or rate a request that belongs to a different stay", async () => {
    const id = await requestIn("COMPLETED");
    expect((await cancelGuestRequest(otherGuest, id)).ok).toBe(false);
    expect((await rateGuestRequest(otherGuest, id, { rating: 3, comment: null })).ok).toBe(false);
    expect((await adminDb.request.findUniqueOrThrow({ where: { id } })).status).toBe("COMPLETED");
  });
});
