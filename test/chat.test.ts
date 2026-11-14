import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { createDepartment } from "@/server/admin/departments";
import { CHAT_MAX_BODY, listChatMessages, postChatMessage } from "@/server/chat";
import { adminDb, createHotelWithData, createStaffUser } from "./fixtures";

type Role = Actor["memberships"][number]["role"];

let hotelId: string;
let otherHotelId: string;
let hkChannel: string;
let engChannel: string;
let otherHotelChannel: string;
let hkEmployee: Actor;
let hkEmployee2: Actor;
let engEmployee: Actor;
let engSupervisor: Actor;
let gm: Actor;
let admin: Actor;
let otherHotelEmployee: Actor;

function actorFrom(user: { id: string; name: string; email: string; hotelId: string }, role: Role, departmentId: string | null): Actor {
  return {
    staffId: user.id,
    hotelId: user.hotelId,
    sessionId: "test-session",
    name: user.name,
    email: user.email,
    memberships: [{ role, departmentId }],
    mfaEnrolled: false,
    mfaVerified: false,
    mustChangePassword: false,
  };
}

const channelOf = async (departmentId: string) =>
  (await adminDb.chatChannel.findUniqueOrThrow({ where: { departmentId } })).id;

beforeAll(async () => {
  const h = await createHotelWithData("chat");
  hotelId = h.hotelId;
  const eng = await adminDb.department.create({ data: { hotelId, code: "ENG", nameEn: "Engineering", nameAr: "الهندسة" } });
  hkChannel = await channelOf(h.dept.id);
  engChannel = await channelOf(eng.id);

  const u = async (hotel: string, email: string, role: Role, dept: string | null) =>
    actorFrom(await createStaffUser(hotel, { email, role, departmentId: dept }), role, dept);
  hkEmployee = await u(hotelId, "hk1@chat.test", "EMPLOYEE", h.dept.id);
  hkEmployee2 = await u(hotelId, "hk2@chat.test", "EMPLOYEE", h.dept.id);
  engEmployee = await u(hotelId, "eng1@chat.test", "EMPLOYEE", eng.id);
  engSupervisor = await u(hotelId, "engs@chat.test", "SUPERVISOR", eng.id);
  gm = { ...(await u(hotelId, "gm@chat.test", "GM", null)), mfaEnrolled: true, mfaVerified: true };
  admin = { ...(await u(hotelId, "admin@chat.test", "HOTEL_ADMIN", null)), mfaEnrolled: true, mfaVerified: true };

  const other = await createHotelWithData("chat-other");
  otherHotelId = other.hotelId;
  otherHotelChannel = await channelOf(other.dept.id);
  otherHotelEmployee = await u(otherHotelId, "hk1@chat-other.test", "EMPLOYEE", other.dept.id);
  await postChatMessage(otherHotelEmployee, otherHotelChannel, "Other hotel only");
});

afterAll(async () => {
  await adminDb.$disconnect();
});

const bodies = (r: Awaited<ReturnType<typeof listChatMessages>>) => (r.ok ? r.messages.map((m) => m.body) : null);

describe("channels", () => {
  it("every department has exactly one channel, including one added from the settings screen", async () => {
    expect(await adminDb.chatChannel.count({ where: { hotelId } })).toBe(2);
    expect(await createDepartment(admin, { code: "SPA", nameEn: "Spa", nameAr: "سبا" })).toMatchObject({ ok: true });
    const spa = await adminDb.department.findFirstOrThrow({ where: { hotelId, code: "SPA" } });
    expect(await adminDb.chatChannel.count({ where: { departmentId: spa.id } })).toBe(1);
  });
});

describe("postChatMessage and listChatMessages", () => {
  it("a member posts and every member of the department reads it, with the author's name", async () => {
    const posted = await postChatMessage(hkEmployee, hkChannel, "  Room 202 needs towels  ");
    expect(posted.ok).toBe(true);

    const read = await listChatMessages(hkEmployee2, hkChannel);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const last = read.messages.at(-1);
    expect(last).toMatchObject({ body: "Room 202 needs towels", authorName: hkEmployee.name });
  });

  it("returns only messages after sinceId, oldest first", async () => {
    await postChatMessage(hkEmployee, hkChannel, "first");
    const first = await listChatMessages(hkEmployee, hkChannel);
    const firstId = first.ok ? first.messages.at(-1)!.id : "";
    await postChatMessage(hkEmployee2, hkChannel, "second");
    await postChatMessage(hkEmployee, hkChannel, "third");

    expect(bodies(await listChatMessages(hkEmployee, hkChannel, firstId))).toEqual(["second", "third"]);
  });

  it("refuses a blank body and a body over the limit", async () => {
    expect((await postChatMessage(hkEmployee, hkChannel, "   ")).ok).toBe(false);
    expect((await postChatMessage(hkEmployee, hkChannel, "x".repeat(CHAT_MAX_BODY + 1))).ok).toBe(false);
  });

  it("a non-member is refused for read and for post", async () => {
    expect((await listChatMessages(engEmployee, hkChannel)).ok).toBe(false);
    expect((await postChatMessage(engEmployee, hkChannel, "Hello housekeeping")).ok).toBe(false);
  });

  it("a member whose membership was removed is refused, even with a stale session (review focus 4)", async () => {
    const { departmentId } = await adminDb.chatChannel.findUniqueOrThrow({ where: { id: hkChannel } });
    const user = await createStaffUser(hotelId, { email: "leaver@chat.test", role: "EMPLOYEE", departmentId });
    const leaver = actorFrom(user, "EMPLOYEE", departmentId); // the session still lists the membership
    expect((await postChatMessage(leaver, hkChannel, "Before I leave")).ok).toBe(true);
    await adminDb.staffMembership.deleteMany({ where: { staffUserId: leaver.staffId } });

    expect((await postChatMessage(leaver, hkChannel, "After I left")).ok).toBe(false);
    expect((await listChatMessages(leaver, hkChannel)).ok).toBe(false);
  });

  it("a supervisor reads every channel in their hotel but posts only in their own", async () => {
    await postChatMessage(engSupervisor, engChannel, "Engineering update");
    expect((await listChatMessages(engSupervisor, hkChannel)).ok).toBe(true);
    expect((await postChatMessage(engSupervisor, hkChannel, "Not my channel")).ok).toBe(false);
    expect(bodies(await listChatMessages(engEmployee, engChannel))).toContain("Engineering update");
  });

  it("the GM reads every channel and cannot post", async () => {
    expect((await listChatMessages(gm, hkChannel)).ok).toBe(true);
    expect((await listChatMessages(gm, engChannel)).ok).toBe(true);
    expect((await postChatMessage(gm, hkChannel, "From the GM")).ok).toBe(false);
  });

  it("never returns another hotel's channel or messages", async () => {
    expect((await listChatMessages(gm, otherHotelChannel)).ok).toBe(false);
    expect((await postChatMessage(hkEmployee, otherHotelChannel, "Cross hotel")).ok).toBe(false);
    const own = await listChatMessages(gm, hkChannel);
    expect(bodies(own)).not.toContain("Other hotel only");
    expect(await adminDb.chatMessage.count({ where: { channelId: otherHotelChannel, hotelId: { not: otherHotelId } } })).toBe(0);
  });

  it("refuses a malformed channel id", async () => {
    expect((await listChatMessages(hkEmployee, "nope")).ok).toBe(false);
    expect((await postChatMessage(hkEmployee, "nope", "hi")).ok).toBe(false);
  });
});
