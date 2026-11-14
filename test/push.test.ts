import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { saveSubscription, sendAlertPush, type PushSender, type PushTarget } from "@/server/push";
import { adminDb, createHotelWithData, createStaffUser } from "./fixtures";

let hotelId: string;
let supervisor: Actor;
let colleague: Actor;

function actorFrom(user: { id: string; name: string; email: string; hotelId: string }): Actor {
  return {
    staffId: user.id,
    hotelId: user.hotelId,
    sessionId: "test-session",
    name: user.name,
    email: user.email,
    memberships: [{ role: "SUPERVISOR", departmentId: null }],
    mfaEnrolled: false,
    mfaVerified: false,
    mustChangePassword: false,
  };
}

let device = 0;
const subscription = (endpoint = `https://push.example.test/device-${++device}`) => ({
  endpoint,
  keys: { p256dh: `p256dh-${device}`, auth: `auth-${device}` },
});

/** A sender that records every call and answers with the status set for each endpoint (201 by default). */
function stubSender(statusByEndpoint: Record<string, number> = {}) {
  const sent: { endpoint: string; payload: string }[] = [];
  const sender: PushSender = {
    async send(target: PushTarget, payload: string) {
      sent.push({ endpoint: target.endpoint, payload });
      return { statusCode: statusByEndpoint[target.endpoint] ?? 201 };
    },
  };
  return { sender, sent };
}

const payload = { title: "Request HK-1001 is waiting", body: "Room 202", url: "/en/staff/requests/x" };

beforeAll(async () => {
  const h = await createHotelWithData("push");
  hotelId = h.hotelId;
  supervisor = actorFrom(await createStaffUser(hotelId, { email: "sup@push.test", role: "SUPERVISOR", departmentId: h.dept.id }));
  colleague = actorFrom(await createStaffUser(hotelId, { email: "col@push.test", role: "SUPERVISOR", departmentId: h.dept.id }));
});

afterAll(async () => {
  await adminDb.$disconnect();
});

const devicesOf = (staffUserId: string) => adminDb.pushSubscription.findMany({ where: { staffUserId } });

describe("saveSubscription", () => {
  it("saves one row per device, and saving the same endpoint again is idempotent", async () => {
    const phone = subscription();
    const laptop = subscription();

    expect((await saveSubscription(supervisor, phone)).ok).toBe(true);
    expect((await saveSubscription(supervisor, phone)).ok).toBe(true);
    expect((await saveSubscription(supervisor, laptop)).ok).toBe(true);

    const rows = await devicesOf(supervisor.staffId);
    expect(rows.map((r) => r.endpoint).sort()).toEqual([phone.endpoint, laptop.endpoint].sort());
    expect(rows.every((r) => r.hotelId === hotelId)).toBe(true);
  });

  it("moves a device to whoever saved it last (a shared phone)", async () => {
    const shared = subscription();
    await saveSubscription(supervisor, shared);
    await saveSubscription(colleague, shared);
    expect(await adminDb.pushSubscription.findMany({ where: { endpoint: shared.endpoint }, select: { staffUserId: true } })).toEqual([
      { staffUserId: colleague.staffId },
    ]);
  });

  it("refuses a malformed subscription and a non-https endpoint", async () => {
    expect((await saveSubscription(supervisor, { endpoint: "https://push.example.test/x" })).ok).toBe(false);
    expect((await saveSubscription(supervisor, { ...subscription(), endpoint: "http://push.example.test/plain" })).ok).toBe(false);
    expect((await saveSubscription(supervisor, "nonsense")).ok).toBe(false);
  });
});

describe("sendAlertPush", () => {
  it("sends the payload to every device of the recipient, and only theirs", async () => {
    const recipient = actorFrom(await createStaffUser(hotelId, { email: "many@push.test", role: "SUPERVISOR" }));
    const a = subscription();
    const b = subscription();
    await saveSubscription(recipient, a);
    await saveSubscription(recipient, b);
    const { sender, sent } = stubSender();

    const result = await sendAlertPush(hotelId, recipient.staffId, payload, sender);

    expect(sent.map((s) => s.endpoint).sort()).toEqual([a.endpoint, b.endpoint].sort());
    expect(JSON.parse(sent[0].payload)).toEqual(payload);
    expect(result).toEqual({ sent: 2, removed: 0 });
  });

  it("deletes a device that answers 410 Gone (or 404), and keeps the others", async () => {
    const recipient = actorFrom(await createStaffUser(hotelId, { email: "gone@push.test", role: "SUPERVISOR" }));
    const gone = subscription();
    const missing = subscription();
    const alive = subscription();
    for (const s of [gone, missing, alive]) await saveSubscription(recipient, s);
    const { sender } = stubSender({ [gone.endpoint]: 410, [missing.endpoint]: 404 });

    const result = await sendAlertPush(hotelId, recipient.staffId, payload, sender);

    expect(result).toEqual({ sent: 1, removed: 2 });
    expect((await devicesOf(recipient.staffId)).map((r) => r.endpoint)).toEqual([alive.endpoint]);
  });

  it("does nothing when the recipient has no device", async () => {
    const { sender, sent } = stubSender();
    const lonely = await createStaffUser(hotelId, { email: "none@push.test", role: "SUPERVISOR" });
    expect(await sendAlertPush(hotelId, lonely.id, payload, sender)).toEqual({ sent: 0, removed: 0 });
    expect(sent).toHaveLength(0);
  });
});
