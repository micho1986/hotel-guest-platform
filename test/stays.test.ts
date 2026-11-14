import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkInGuest,
  checkOutGuest,
  getStay,
  listAvailableRooms,
  listStays,
  reissueGuestToken,
  stayIdForToken,
  verifyCardToken,
} from "@/server/admin/stays";
import { ForbiddenError, type Actor } from "@/server/auth/permissions";
import { hashAccessToken } from "@/server/tokens";
import { adminDb, createHotelWithData, createStaffUser } from "./fixtures";

const DAY = 24 * 60 * 60 * 1000;

let hotelId: string;
let roomId: string;
let frontDesk: Actor;
let employee: Actor;

function actorFrom(user: { id: string; hotelId: string }, role: Actor["memberships"][number]["role"]): Actor {
  return {
    staffId: user.id,
    hotelId: user.hotelId,
    sessionId: "00000000-0000-4000-8000-0000000000bb",
    name: "Test",
    email: "test@test.hotel",
    memberships: [{ role, departmentId: null }],
    mfaEnrolled: false,
    mfaVerified: false,
    mustChangePassword: false,
  };
}

function input(room: string) {
  return {
    roomId: room,
    guestDisplayName: "Test Guest",
    checkIn: new Date(Date.now() - DAY).toISOString(),
    checkOut: new Date(Date.now() + 2 * DAY).toISOString(),
  };
}

beforeAll(async () => {
  const h = await createHotelWithData("stays");
  hotelId = h.hotelId;
  const room = await adminDb.room.create({ data: { hotelId, number: "303" } });
  roomId = room.id;
  const fd = await createStaffUser(hotelId, { email: "fd@stays.test", role: "FRONT_DESK" });
  const em = await createStaffUser(hotelId, { email: "em@stays.test", role: "EMPLOYEE" });
  frontDesk = actorFrom({ id: fd.id, hotelId }, "FRONT_DESK");
  employee = actorFrom({ id: em.id, hotelId }, "EMPLOYEE");
});

afterAll(async () => {
  await adminDb.$disconnect();
});

describe("stay services", () => {
  it("checks a guest in and returns a token once", async () => {
    const r = await checkInGuest(frontDesk, input(roomId));
    expect(r.ok).toBe(true);
    expect(r.ok && r.secret?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await adminDb.stay.findFirstOrThrow({ where: { roomId, status: "ACTIVE" } });
    expect(row.accessTokenHash).toBe(hashAccessToken((r as { secret: { value: string } }).secret.value));
  });

  it("refuses a second active stay in the same room", async () => {
    const r = await checkInGuest(frontDesk, input(roomId));
    expect(r.ok).toBe(false);
    expect(r.message).toBe("This room already has a guest.");
  });

  it("reissue revokes the old token", async () => {
    const old = await adminDb.stay.findFirstOrThrow({ where: { roomId, status: "ACTIVE" } });
    const before = old.accessTokenHash;
    const again = await reissueGuestToken(frontDesk, { stayId: old.id });
    expect(again.ok).toBe(true);
    const after = await adminDb.stay.findFirstOrThrow({ where: { id: old.id } });
    expect(after.accessTokenHash).not.toBe(before);
    expect(after.accessTokenHash).toBe(hashAccessToken((again as { secret: { value: string } }).secret.value));
  });

  it("check-out sets CHECKED_OUT, revokes the token, and blocks reissue afterwards", async () => {
    const stay = await adminDb.stay.findFirstOrThrow({ where: { roomId, status: "ACTIVE" } });
    const out = await checkOutGuest(frontDesk, { stayId: stay.id });
    expect(out.ok).toBe(true);
    const row = await adminDb.stay.findFirstOrThrow({ where: { id: stay.id } });
    expect(row.status).toBe("CHECKED_OUT");
    expect(row.tokenRevokedAt).not.toBeNull();
    const again = await reissueGuestToken(frontDesk, { stayId: stay.id });
    expect(again.ok).toBe(false);
    expect(again.message).toBe("This stay has ended.");
  });

  it("lists and reads stays for front desk, with the room number", async () => {
    const all = await listStays(frontDesk);
    expect(all.length).toBeGreaterThan(0);
    expect(all[0].room.number).toBeDefined();
    const one = await getStay(frontDesk, all[0].id);
    expect(one?.id).toBe(all[0].id);
  });

  it("only the current token passes card verification; a reissued one does not", async () => {
    const fresh = await adminDb.room.create({ data: { hotelId, number: "505" } });
    const first = await checkInGuest(frontDesk, { ...input(fresh.id) });
    const stayId = await stayIdForToken(frontDesk, (first as { secret: { value: string } }).secret.value);
    expect(stayId).not.toBeNull();
    const oldToken = (first as { secret: { value: string } }).secret.value;
    expect(await verifyCardToken(frontDesk, stayId!, oldToken)).toBe(true);
    const again = await reissueGuestToken(frontDesk, { stayId });
    const newToken = (again as { secret: { value: string } }).secret.value;
    expect(await verifyCardToken(frontDesk, stayId!, oldToken)).toBe(false);
    expect(await verifyCardToken(frontDesk, stayId!, newToken)).toBe(true);
  });

  it("lists a room until a guest is in it, then drops it", async () => {
    const room = await adminDb.room.create({ data: { hotelId, number: "606" } });
    expect((await listAvailableRooms(frontDesk)).map((r) => r.id)).toContain(room.id);
    await checkInGuest(frontDesk, input(room.id));
    expect((await listAvailableRooms(frontDesk)).map((r) => r.id)).not.toContain(room.id);
  });

  it("an employee cannot check in", async () => {
    await expect(checkInGuest(employee, input(roomId))).rejects.toThrow(ForbiddenError);
  });
});
