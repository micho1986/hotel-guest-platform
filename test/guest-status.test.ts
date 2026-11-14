import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GuestStay } from "@/server/guest";
import { guestFeedback, guestTimeline } from "@/server/guest-requests";
import { adminDb, createHotelWithData } from "./fixtures";

let guest: GuestStay;
let otherGuest: GuestStay;
let requestId: string;

beforeAll(async () => {
  const h = await createHotelWithData("guestlive");
  const a = await h.createStay();
  const b = await h.createStay();
  guest = { stayId: a.stay.id, hotelId: h.hotelId };
  otherGuest = { stayId: b.stay.id, hotelId: h.hotelId };
  requestId = (await h.createRequest(guest.stayId)).id;
  await adminDb.requestEvent.createMany({
    data: [
      { hotelId: h.hotelId, requestId, actorType: "GUEST", toStatus: "SUBMITTED" },
      { hotelId: h.hotelId, requestId, actorType: "SYSTEM", fromStatus: "SUBMITTED", toStatus: "RECEIVED" },
      { hotelId: h.hotelId, requestId, actorType: "STAFF", fromStatus: "RECEIVED", toStatus: "RECEIVED", note: "guest asked for sheets, not towels", isInternal: true },
    ],
  });
  await adminDb.requestFeedback.create({ data: { hotelId: h.hotelId, requestId, rating: 5 } });
});

afterAll(async () => {
  await adminDb.$disconnect();
});

describe("guest timeline (G6)", () => {
  it("shows the guest the status steps, and never the internal notes", async () => {
    const steps = await guestTimeline(guest, requestId);
    expect(steps.map((s) => s.toStatus)).toEqual(["SUBMITTED", "RECEIVED"]);
    expect(JSON.stringify(steps)).not.toContain("towels");
  });

  it("gives another stay's guest nothing", async () => {
    expect(await guestTimeline(otherGuest, requestId)).toEqual([]);
  });
});

describe("guest rating read", () => {
  it("returns this guest's rating and nothing for another stay", async () => {
    expect(await guestFeedback(guest, requestId)).toEqual({ rating: 5, comment: null });
    expect(await guestFeedback(otherGuest, requestId)).toBeNull();
  });
});
