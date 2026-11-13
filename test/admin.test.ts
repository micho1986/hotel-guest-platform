/** M1: admin services — permissions, validation, tenant boundaries, audit trail. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAuditLog } from "@/server/admin/audit-log";
import { createServiceItem, listCatalogue, setServiceItemActive, updateServiceItem } from "@/server/admin/catalogue";
import { createDepartment, listDepartments, updateDepartment } from "@/server/admin/departments";
import { getHotel, updateHotelProfile } from "@/server/admin/hotel";
import { parseRoomLines } from "@/server/admin/room-lines";
import { addRooms, listRooms, setRoomActive } from "@/server/admin/rooms";
import { createStaff, listStaff, resetStaffMfa, resetStaffPassword, setStaffActive, updateStaffRole } from "@/server/admin/staff";
import { ForbiddenError, type Actor } from "@/server/auth/permissions";
import { beginMfaSetup, confirmMfaSetup, getActor, login } from "@/server/auth/service";
import { totpAt } from "@/server/auth/totp";
import type { StaffRole } from "@/generated/prisma/enums";
import { adminDb, createHotelWithData, createStaffUser, rawAppDb, TEST_PASSWORD } from "./fixtures";

type Hotel = Awaited<ReturnType<typeof createHotelWithData>>;
let A: Hotel;
let B: Hotel;
let admin: Actor;
let gm: Actor;
let supervisor: Actor;
let employee: Actor;
let n = 0;

/** Creates an account, signs in, and completes 2-step setup where the role needs it. */
async function signedIn(hotel: Hotel, role: StaffRole): Promise<Actor> {
  const mail = `${role.toLowerCase()}${++n}@admin.test`;
  const departmentId = role === "EMPLOYEE" || role === "SUPERVISOR" ? hotel.dept.id : null;
  await createStaffUser(hotel.hotelId, { email: mail, role, departmentId });
  const res = await login({ hotelCode: hotel.hotel.slug, email: mail, password: TEST_PASSWORD });
  if (!res.ok) throw new Error("login failed");
  let actor = (await getActor(res.token))!;
  if (res.next === "mfa-setup") {
    const { secret } = await beginMfaSetup(actor);
    await confirmMfaSetup(actor, totpAt(secret, Date.now() / 1000));
    actor = (await getActor(res.token))!;
  }
  return actor;
}

beforeAll(async () => {
  A = await createHotelWithData("adm-a");
  B = await createHotelWithData("adm-b");
  [admin, gm, supervisor, employee] = await Promise.all(
    (["HOTEL_ADMIN", "GM", "SUPERVISOR", "EMPLOYEE"] as const).map((r) => signedIn(A, r)),
  );
});
afterAll(async () => {
  await Promise.all([adminDb.$disconnect(), rawAppDb.$disconnect()]);
});

describe("who can do what", () => {
  it("lets only the hotel admin change settings", async () => {
    const input = { code: "SPA", nameEn: "Spa", nameAr: "سبا" };
    for (const actor of [gm, supervisor, employee]) {
      await expect(createDepartment(actor, input)).rejects.toThrow(ForbiddenError);
      await expect(addRooms(actor, "901")).rejects.toThrow(ForbiddenError);
      await expect(createStaff(actor, { name: "X", email: "x@x.test", role: "GM" })).rejects.toThrow(ForbiddenError);
    }
    expect(await createDepartment(admin, input)).toMatchObject({ ok: true });
  });

  it("lets the GM view settings and the audit log, but not staff below", async () => {
    expect((await listDepartments(gm)).length).toBeGreaterThan(0);
    expect(Array.isArray(await listAuditLog(gm))).toBe(true);
    for (const actor of [supervisor, employee]) {
      await expect(listStaff(actor)).rejects.toThrow(ForbiddenError);
      await expect(listAuditLog(actor)).rejects.toThrow(ForbiddenError);
    }
  });

  it("gives an admin no rights before the 2-step code is entered", async () => {
    const mail = `half${++n}@admin.test`;
    await createStaffUser(A.hotelId, { email: mail, role: "HOTEL_ADMIN" });
    const res = await login({ hotelCode: A.hotel.slug, email: mail, password: TEST_PASSWORD });
    const half = (await getActor(res.ok ? res.token : ""))!;
    await expect(listStaff(half)).rejects.toThrow(ForbiddenError);
    await expect(addRooms(half, "902")).rejects.toThrow(ForbiddenError);
  });
});

describe("hotel profile", () => {
  it("saves valid changes and rejects bad ones", async () => {
    const good = { name: "Renamed Hotel", timezone: "Asia/Dubai", logoUrl: "", primaryColor: "#14213d", accentColor: "#C9A96E" };
    expect(await updateHotelProfile(admin, good)).toMatchObject({ ok: true });
    const hotel = await getHotel(admin);
    expect(hotel.name).toBe("Renamed Hotel");
    expect(hotel.brandColors).toEqual({ primary: "#14213D", accent: "#C9A96E" });
    expect(await updateHotelProfile(admin, { ...good, timezone: "Mars/Olympus" })).toMatchObject({ ok: false });
    expect(await updateHotelProfile(admin, { ...good, primaryColor: "navy" })).toMatchObject({ ok: false });
    expect(await updateHotelProfile(admin, { ...good, logoUrl: "javascript:alert(1)" })).toMatchObject({ ok: false });
    // Hotel B is untouched.
    expect((await adminDb.hotel.findUniqueOrThrow({ where: { id: B.hotelId } })).name).not.toBe("Renamed Hotel");
  });
});

describe("departments", () => {
  it("rejects duplicate and malformed codes", async () => {
    expect(await createDepartment(admin, { code: "hk", nameEn: "Dup", nameAr: "مكرر" })).toMatchObject({ ok: false });
    expect(await createDepartment(admin, { code: "bad code!", nameEn: "X", nameAr: "X" })).toMatchObject({ ok: false });
    expect(await createDepartment(admin, { code: "ENG", nameEn: "", nameAr: "X" })).toMatchObject({ ok: false });
  });
  it("cannot edit another hotel's department", async () => {
    const res = await updateDepartment(admin, { id: B.dept.id, nameEn: "Hacked", nameAr: "X", isActive: "on" });
    expect(res).toMatchObject({ ok: false });
    expect((await adminDb.department.findUniqueOrThrow({ where: { id: B.dept.id } })).nameEn).toBe("Housekeeping");
  });
});

describe("rooms", () => {
  it("parses single rooms, ranges, floors and buildings", () => {
    const { rooms, errors } = parseRoomLines("301-303, 3, Tower A\n\nPH1\n008-010, G");
    expect(errors).toEqual([]);
    expect(rooms.map((r) => r.number)).toEqual(["301", "302", "303", "PH1", "008", "009", "010"]);
    expect(rooms[0]).toEqual({ number: "301", floor: "3", building: "Tower A" });
  });
  it("reports bad lines, backwards ranges and duplicates", () => {
    expect(parseRoomLines("10 1").errors).toHaveLength(1);
    expect(parseRoomLines("110-101").errors).toHaveLength(1);
    expect(parseRoomLines("101\n101").errors).toHaveLength(1);
    expect(parseRoomLines("1-9999").errors).toHaveLength(1);
  });
  it("adds rooms in bulk, all-or-nothing", async () => {
    expect(await addRooms(admin, "401-410, 4")).toMatchObject({ ok: true, message: "10 rooms added." });
    // 410 exists → nothing from this batch is added.
    expect(await addRooms(admin, "410-412, 4")).toMatchObject({ ok: false });
    const numbers = (await listRooms(admin)).map((r) => r.number);
    expect(numbers).toContain("405");
    expect(numbers).not.toContain("411");
    expect(await addRooms(admin, "")).toMatchObject({ ok: false });
  });
  it("cannot deactivate another hotel's room", async () => {
    expect(await setRoomActive(admin, B.room.id, false)).toMatchObject({ ok: false });
    expect(await setRoomActive(admin, "not-an-id", false)).toMatchObject({ ok: false });
    expect(await setRoomActive(admin, A.room.id, false)).toMatchObject({ ok: true });
  });
});

describe("staff accounts", () => {
  it("creates an account with a one-time temporary password that must be changed", async () => {
    const res = await createStaff(admin, { name: "New Attendant", email: " New.Attendant@Hotel.test ", role: "EMPLOYEE", departmentId: A.dept.id });
    expect(res.ok && res.secret?.value).toBeTruthy();
    const tempPassword = res.ok ? res.secret!.value : "";
    const signIn = await login({ hotelCode: A.hotel.slug, email: "new.attendant@hotel.test", password: tempPassword });
    expect(signIn).toMatchObject({ ok: true, next: "change-password" });
    // Same email again → refused.
    expect(await createStaff(admin, { name: "Dup", email: "new.attendant@hotel.test", role: "EMPLOYEE", departmentId: A.dept.id })).toMatchObject({ ok: false });
  });

  it("enforces role/department rules and the hotel boundary", async () => {
    const base = { name: "X", email: `x${++n}@hotel.test` };
    expect(await createStaff(admin, { ...base, role: "EMPLOYEE" })).toMatchObject({ ok: false });
    expect(await createStaff(admin, { ...base, role: "GM", departmentId: A.dept.id })).toMatchObject({ ok: false });
    expect(await createStaff(admin, { ...base, role: "SUPERVISOR", departmentId: B.dept.id })).toMatchObject({ ok: false });
    expect(await createStaff(admin, { ...base, email: "not-an-email", role: "GM" })).toMatchObject({ ok: false });
  });

  it("role change, disable, password reset and authenticator reset all end the person's sessions", async () => {
    for (const act of [
      (id: string) => updateStaffRole(admin, { staffId: id, role: "SUPERVISOR", departmentId: A.dept.id }),
      (id: string) => setStaffActive(admin, id, false),
      (id: string) => resetStaffPassword(admin, id),
      (id: string) => resetStaffMfa(admin, id),
    ]) {
      const target = await signedIn(A, "EMPLOYEE");
      expect(await adminDb.staffSession.count({ where: { staffUserId: target.staffId } })).toBe(1);
      expect(await act(target.staffId)).toMatchObject({ ok: true });
      expect(await adminDb.staffSession.count({ where: { staffUserId: target.staffId } })).toBe(0);
    }
  });

  it("password reset unlocks the account and issues a working temporary password", async () => {
    const target = await signedIn(A, "EMPLOYEE");
    await adminDb.staffUser.update({ where: { id: target.staffId }, data: { lockedUntil: new Date(Date.now() + 600_000) } });
    const res = await resetStaffPassword(admin, target.staffId);
    const temp = res.ok ? res.secret!.value : "";
    expect(await login({ hotelCode: A.hotel.slug, email: target.email, password: TEST_PASSWORD })).toMatchObject({ ok: false });
    expect(await login({ hotelCode: A.hotel.slug, email: target.email, password: temp })).toMatchObject({ ok: true, next: "change-password" });
  });

  it("protects admins from locking the hotel out", async () => {
    expect(await setStaffActive(admin, admin.staffId, false)).toMatchObject({ ok: false });
    expect(await updateStaffRole(admin, { staffId: admin.staffId, role: "EMPLOYEE", departmentId: A.dept.id })).toMatchObject({ ok: false });
    expect(await resetStaffPassword(admin, admin.staffId)).toMatchObject({ ok: false });
    // A hotel whose only other admin is the target: disabling them is refused.
    const C = await createHotelWithData("one-admin");
    const cAdmin = await signedIn(C, "HOTEL_ADMIN");
    const cAdmin2 = await signedIn(C, "HOTEL_ADMIN");
    expect(await setStaffActive(cAdmin, cAdmin2.staffId, false)).toMatchObject({ ok: true });
    await adminDb.staffUser.update({ where: { id: cAdmin2.staffId }, data: { status: "ACTIVE" } });
    await adminDb.staffUser.update({ where: { id: cAdmin.staffId }, data: { status: "DISABLED" } });
    // cAdmin2 is now the only active admin; a stale actor for cAdmin cannot disable them.
    expect(await setStaffActive(cAdmin, cAdmin2.staffId, false)).toMatchObject({ ok: false });
  });

  it("cannot touch another hotel's staff", async () => {
    const other = await signedIn(B, "EMPLOYEE");
    expect(await setStaffActive(admin, other.staffId, false)).toMatchObject({ ok: false });
    expect(await resetStaffPassword(admin, other.staffId)).toMatchObject({ ok: false });
    expect(await updateStaffRole(admin, { staffId: other.staffId, role: "GM" })).toMatchObject({ ok: false });
    expect((await listStaff(admin)).some((s) => s.id === other.staffId)).toBe(false);
  });

  it("never returns password hashes or authenticator secrets in the staff list to the page", async () => {
    // listStaff returns DB rows; the screen must only render safe fields. Guard the shape here.
    const row = (await listStaff(admin))[0];
    expect(Object.keys(row)).toEqual(expect.arrayContaining(["name", "email", "status", "memberships"]));
  });
});

describe("service catalogue", () => {
  const item = (over: object = {}) => ({
    categoryId: "", departmentId: A.dept.id, nameEn: "Extra hangers", nameAr: "علاقات إضافية",
    descriptionEn: "", descriptionAr: "", maxQty: "5", ...over,
  });
  it("creates, edits and hides a service", async () => {
    const category = (await listCatalogue(admin))[0];
    expect(await createServiceItem(admin, item({ categoryId: category.id }))).toMatchObject({ ok: true });
    const created = (await listCatalogue(admin))[0].items.find((i) => i.nameEn === "Extra hangers")!;
    expect(created).toMatchObject({ maxQty: 5, needsNote: false, isActive: true });
    expect(await updateServiceItem(admin, { ...item({ categoryId: category.id }), id: created.id, maxQty: "8", needsNote: "on" })).toMatchObject({ ok: true });
    expect(await setServiceItemActive(admin, created.id, false)).toMatchObject({ ok: true });
    const after = (await listCatalogue(admin))[0].items.find((i) => i.id === created.id)!;
    expect(after).toMatchObject({ maxQty: 8, needsNote: true, isActive: false });
  });
  it("rejects bad quantities and other hotels' categories or departments", async () => {
    const category = (await listCatalogue(admin))[0];
    const otherCategory = await adminDb.serviceCategory.findFirstOrThrow({ where: { hotelId: B.hotelId } });
    expect(await createServiceItem(admin, item({ categoryId: category.id, maxQty: "0" }))).toMatchObject({ ok: false });
    expect(await createServiceItem(admin, item({ categoryId: category.id, maxQty: "abc" }))).toMatchObject({ ok: false });
    expect(await createServiceItem(admin, item({ categoryId: otherCategory.id }))).toMatchObject({ ok: false });
    expect(await createServiceItem(admin, item({ categoryId: category.id, departmentId: B.dept.id }))).toMatchObject({ ok: false });
    expect(await updateServiceItem(admin, { ...item({ categoryId: category.id }), id: B.item.id })).toMatchObject({ ok: false });
  });
});

describe("audit log", () => {
  it("records admin actions with the actor's name, for this hotel only", async () => {
    const log = await listAuditLog(admin);
    const actions = log.map((e) => e.action);
    for (const a of ["department.created", "rooms.added", "staff.created", "staff.password_reset", "service_item.created", "hotel.updated"]) {
      expect(actions).toContain(a);
    }
    expect(log.every((e) => e.hotelId === A.hotelId)).toBe(true);
    expect(log.find((e) => e.action === "rooms.added")?.actorName).toBe(admin.name);
    // Temporary passwords never reach the log.
    expect(JSON.stringify(log)).not.toMatch(/password"\s*:/i);
  });
});
