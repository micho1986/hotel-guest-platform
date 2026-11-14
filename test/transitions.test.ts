import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTransition, TRANSITIONS } from "@/server/requests/transitions";
import { adminDb, createHotelWithData } from "./fixtures";

const ALL = ["SUBMITTED", "RECEIVED", "ACCEPTED", "IN_PROGRESS", "WAITING_FOR_GUEST", "COMPLETED", "CANCELLED"] as const;

let hotelId: string;
let createRequest: (stayId: string | null) => Promise<{ id: string }>;

beforeAll(async () => {
  const h = await createHotelWithData("transitions");
  hotelId = h.hotelId;
  createRequest = h.createRequest;
});
afterAll(async () => {
  await adminDb.$disconnect();
});

const staff = { type: "STAFF" as const, id: randomUUID() };
const eventCount = (requestId: string) => adminDb.requestEvent.count({ where: { requestId } });

describe("transition table (PRD §5)", () => {
  it("matches the lifecycle in the design", () => {
    expect(TRANSITIONS.SUBMITTED).toEqual(["RECEIVED", "CANCELLED"]);
    expect(TRANSITIONS.RECEIVED).toEqual(["RECEIVED", "ACCEPTED", "CANCELLED"]);
    expect(TRANSITIONS.ACCEPTED).toEqual(["IN_PROGRESS"]);
    expect(TRANSITIONS.IN_PROGRESS).toEqual(["WAITING_FOR_GUEST", "COMPLETED"]);
    expect(TRANSITIONS.WAITING_FOR_GUEST).toEqual(["IN_PROGRESS"]);
    expect(TRANSITIONS.COMPLETED).toEqual([]);
    expect(TRANSITIONS.CANCELLED).toEqual([]);
  });
});

// Every pair of statuses: legal pairs change the status and write exactly one event; illegal pairs change nothing.
for (const from of ALL) {
  for (const to of ALL) {
    const legal = (TRANSITIONS[from] as readonly string[]).includes(to);
    it(`${from} → ${to} is ${legal ? "allowed" : "refused"}`, async () => {
      const req = await createRequest(null);
      await adminDb.request.update({ where: { id: req.id }, data: { status: from } });
      const before = await eventCount(req.id);

      const result = await applyTransition(hotelId, { requestId: req.id, from: [from], to, actor: staff });

      const row = await adminDb.request.findUniqueOrThrow({ where: { id: req.id } });
      if (legal) {
        expect(result.ok).toBe(true);
        expect(row.status).toBe(to);
        expect(await eventCount(req.id)).toBe(before + 1);
        const last = await adminDb.requestEvent.findFirstOrThrow({ where: { requestId: req.id }, orderBy: { createdAt: "desc" } });
        expect(last.fromStatus).toBe(from);
        expect(last.toStatus).toBe(to);
      } else {
        expect(result.ok).toBe(false);
        expect(row.status).toBe(from);
        expect(await eventCount(req.id)).toBe(before);
      }
    });
  }
}

describe("applyTransition safety", () => {
  it("lets exactly one of two simultaneous accepts succeed", async () => {
    const req = await createRequest(null);
    await adminDb.request.update({ where: { id: req.id }, data: { status: "RECEIVED" } });
    const [a, b] = await Promise.all([
      applyTransition(hotelId, { requestId: req.id, from: ["RECEIVED"], to: "ACCEPTED", actor: { type: "STAFF", id: randomUUID() } }),
      applyTransition(hotelId, { requestId: req.id, from: ["RECEIVED"], to: "ACCEPTED", actor: { type: "STAFF", id: randomUUID() } }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const accepted = await adminDb.requestEvent.count({ where: { requestId: req.id, toStatus: "ACCEPTED" } });
    expect(accepted).toBe(1);
    const loser = a.ok ? b : a;
    expect(loser.ok ? "" : loser.message).toBe("This request has already changed.");
  });

  it("refuses a transition for a request in another hotel", async () => {
    const other = await createHotelWithData("transitions-other");
    const req = await other.createRequest(null);
    const result = await applyTransition(hotelId, { requestId: req.id, from: ["SUBMITTED"], to: "RECEIVED", actor: { type: "SYSTEM", id: null } });
    expect(result.ok).toBe(false);
    const row = await adminDb.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(row.status).toBe("SUBMITTED");
  });
});
