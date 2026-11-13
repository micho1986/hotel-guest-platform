/**
 * Acceptance tests T1–T3 from the MVP Implementation Plan (section 8).
 * Run against a real Postgres with the shipped migrations and RLS policies.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantDb } from "@/server/db";
import { getGuestRequest, listGuestRequests, resolveGuestToken } from "@/server/guest";
import { adminDb, createHotelWithData, rawAppDb } from "./fixtures";

type Hotel = Awaited<ReturnType<typeof createHotelWithData>>;
let A: Hotel;
let B: Hotel;
let requestA: { id: string };
let requestB: { id: string };

beforeAll(async () => {
  A = await createHotelWithData("a");
  B = await createHotelWithData("b");
  const stayA = await A.createStay();
  const stayB = await B.createStay();
  requestA = await A.createRequest(stayA.stay.id);
  requestB = await B.createRequest(stayB.stay.id);
});

afterAll(async () => {
  await Promise.all([adminDb.$disconnect(), rawAppDb.$disconnect()]);
});

describe("T1 — a hotel cannot reach another hotel's data through the app layer", () => {
  it("cannot read Hotel B's request by id", async () => {
    const db = tenantDb(A.hotelId);
    expect(await db.request.findUnique({ where: { id: requestB.id } })).toBeNull();
    expect(await db.request.findFirst({ where: { id: requestB.id } })).toBeNull();
    expect(await db.request.findMany({ where: { id: requestB.id } })).toEqual([]);
  });

  it("only sees its own rows when listing", async () => {
    const ids = (await tenantDb(A.hotelId).request.findMany()).map((r) => r.id);
    expect(ids).toContain(requestA.id);
    expect(ids).not.toContain(requestB.id);
    expect(await tenantDb(A.hotelId).hotel.findMany()).toHaveLength(1);
  });

  it("cannot update or delete Hotel B's request", async () => {
    const db = tenantDb(A.hotelId);
    await expect(db.request.update({ where: { id: requestB.id }, data: { qty: 3 } })).rejects.toThrow();
    expect((await db.request.updateMany({ where: { id: requestB.id }, data: { qty: 3 } })).count).toBe(0);
    expect((await db.request.deleteMany({ where: { id: requestB.id } })).count).toBe(0);
    const untouched = await adminDb.request.findUniqueOrThrow({ where: { id: requestB.id } });
    expect(untouched.qty).toBe(2);
  });

  it("writes its own hotel id on create, even if the caller passes another", async () => {
    const created = await tenantDb(A.hotelId).department.create({
      data: { hotelId: B.hotelId, code: "ENG", nameEn: "Engineering", nameAr: "الصيانة" },
    });
    expect(created.hotelId).toBe(A.hotelId);
  });

  it("rejects a malformed hotel id", () => {
    expect(() => tenantDb("' OR 1=1 --")).toThrow();
  });
});

describe("T2 — row-level security holds even with the app-layer filter bypassed", () => {
  // Raw runtime-role client: no hotelId added to queries; only RLS stands guard.
  async function asTenant<T>(hotelId: string, query: (db: typeof rawAppDb) => Promise<T>) {
    return rawAppDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.hotel_id', ${hotelId}, TRUE)`;
      return query(tx as unknown as typeof rawAppDb);
    });
  }

  it("returns no rows at all when no tenant is set", async () => {
    expect(await rawAppDb.request.findMany()).toEqual([]);
    expect(await rawAppDb.hotel.findMany()).toEqual([]);
  });

  it("returns only Hotel A's rows for an unfiltered query as Hotel A", async () => {
    const rows = await asTenant(A.hotelId, (db) => db.request.findMany());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.hotelId === A.hotelId)).toBe(true);
    expect(await asTenant(A.hotelId, (db) => db.request.findUnique({ where: { id: requestB.id } }))).toBeNull();
  });

  it("cannot update Hotel B's rows as Hotel A", async () => {
    const res = await asTenant(A.hotelId, (db) => db.request.updateMany({ where: { id: requestB.id }, data: { qty: 4 } }));
    expect(res.count).toBe(0);
  });

  it("cannot insert a row for Hotel B while acting as Hotel A", async () => {
    await expect(
      asTenant(A.hotelId, (db) =>
        db.department.create({ data: { hotelId: B.hotelId, code: "X1", nameEn: "X", nameAr: "X" } }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("cannot rewrite or delete history (request_events is append-only)", async () => {
    await adminDb.requestEvent.create({
      data: { hotelId: A.hotelId, requestId: requestA.id, actorType: "SYSTEM", toStatus: "RECEIVED" },
    });
    await expect(asTenant(A.hotelId, (db) => db.requestEvent.deleteMany())).rejects.toThrow(/permission denied/i);
  });
});

describe("T3 — a guest can only reach their own stay's requests", () => {
  it("cannot read another stay's request in the same room", async () => {
    // Room change / next guest: two stays in room 202 at Hotel A.
    const first = await A.createStay();
    const second = await A.createStay();
    const ownRequest = await A.createRequest(first.stay.id);
    const otherRequest = await A.createRequest(second.stay.id);

    const guest = await resolveGuestToken(first.token);
    expect(guest).toEqual({ stayId: first.stay.id, hotelId: A.hotelId });

    expect(await getGuestRequest(guest!, ownRequest.id)).not.toBeNull();
    expect(await getGuestRequest(guest!, otherRequest.id)).toBeNull();
    const listed = (await listGuestRequests(guest!)).map((r) => r.id);
    expect(listed).toEqual([ownRequest.id]);
  });

  it("cannot reach another hotel's request even with its id", async () => {
    const { token } = await A.createStay();
    const guest = await resolveGuestToken(token);
    expect(await getGuestRequest(guest!, requestB.id)).toBeNull();
  });

  it("refuses revoked, expired and unknown tokens", async () => {
    const revoked = await A.createStay({ revoked: true });
    const expired = await A.createStay({ checkOutInDays: -1 });
    expect(await resolveGuestToken(revoked.token)).toBeNull();
    expect(await resolveGuestToken(expired.token)).toBeNull();
    expect(await resolveGuestToken("not-a-real-token")).toBeNull();
    expect(await resolveGuestToken("")).toBeNull();
  });
});
