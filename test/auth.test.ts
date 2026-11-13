/** M1: sign-in, lockout, sessions, 2-step codes, password change. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/server/auth/encryption";
import { can, type Actor } from "@/server/auth/permissions";
import { generateTemporaryPassword, passwordProblem } from "@/server/auth/passwords";
import {
  beginMfaSetup,
  changePassword,
  confirmMfaSetup,
  getActor,
  login,
  logout,
  MAX_FAILED_ATTEMPTS,
  verifyMfa,
} from "@/server/auth/service";
import { base32Decode, base32Encode, totpAt, verifyTotp } from "@/server/auth/totp";
import { adminDb, createHotelWithData, createStaffUser, rawAppDb, TEST_PASSWORD } from "./fixtures";

type Hotel = Awaited<ReturnType<typeof createHotelWithData>>;
let A: Hotel;
let B: Hotel;
let n = 0;
const email = (p: string) => `${p}${++n}@test.hotel`;

async function signIn(hotel: Hotel, mail: string, password = TEST_PASSWORD) {
  return login({ hotelCode: hotel.hotel.slug, email: mail, password });
}
async function actorFor(hotel: Hotel, mail: string): Promise<{ actor: Actor; token: string }> {
  const res = await signIn(hotel, mail);
  if (!res.ok) throw new Error("login failed in test setup");
  return { actor: (await getActor(res.token))!, token: res.token };
}

beforeAll(async () => {
  A = await createHotelWithData("auth-a");
  B = await createHotelWithData("auth-b");
});
afterAll(async () => {
  await Promise.all([adminDb.$disconnect(), rawAppDb.$disconnect()]);
});

describe("TOTP codes (RFC 6238)", () => {
  // Published test vector: ASCII secret "12345678901234567890", SHA-1.
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("matches the RFC test vectors", () => {
    expect(totpAt(secret, 59, 8)).toBe("94287082");
    expect(totpAt(secret, 1111111109, 8)).toBe("07081804");
    expect(totpAt(secret, 1234567890, 8)).toBe("89005924");
  });
  it("accepts the current code and one step of clock drift, nothing else", () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpAt(secret, now / 1000), now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now / 1000 - 30), now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now / 1000 - 120), now)).toBe(false);
    expect(verifyTotp(secret, "12345", now)).toBe(false);
    expect(verifyTotp(secret, "abcdef", now)).toBe(false);
  });
  it("round-trips base32", () => {
    const buf = Buffer.from("any bytes \x00\xff here", "latin1");
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
  });
});

describe("secrets and passwords", () => {
  it("encrypts authenticator secrets and detects tampering", () => {
    const stored = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(stored).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(stored)).toBe("JBSWY3DPEHPK3PXP");
    expect(encryptSecret("JBSWY3DPEHPK3PXP")).not.toBe(stored);
    const parts = stored.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
  it("enforces the password rules", () => {
    expect(passwordProblem("short1")).not.toBeNull();
    expect(passwordProblem("onlyletterslong")).not.toBeNull();
    expect(passwordProblem("Good-Password-1")).toBeNull();
    for (let i = 0; i < 20; i++) expect(passwordProblem(generateTemporaryPassword())).toBeNull();
  });
});

describe("sign-in", () => {
  it("signs an employee in and resolves the session", async () => {
    const mail = email("emp");
    await createStaffUser(A.hotelId, { email: mail, role: "EMPLOYEE", departmentId: A.dept.id });
    const res = await signIn(A, mail);
    expect(res).toMatchObject({ ok: true, next: "home" });
    if (!res.ok) return;
    const actor = await getActor(res.token);
    expect(actor).toMatchObject({ hotelId: A.hotelId, email: mail });
    // Only the hash of the session token is stored.
    const sessions = await adminDb.staffSession.findMany({ where: { staffUserId: actor!.staffId } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).not.toBe(res.token);
  });

  it("accepts the email in any letter case", async () => {
    const mail = email("case");
    await createStaffUser(A.hotelId, { email: mail, role: "EMPLOYEE", departmentId: A.dept.id });
    expect((await signIn(A, `  ${mail.toUpperCase()} `)).ok).toBe(true);
  });

  it("gives the same vague error for wrong password, unknown email and unknown hotel", async () => {
    const mail = email("vague");
    await createStaffUser(A.hotelId, { email: mail, role: "EMPLOYEE", departmentId: A.dept.id });
    expect(await signIn(A, mail, "wrong-password-1")).toEqual({ ok: false, error: "invalid" });
    expect(await signIn(A, "nobody@test.hotel")).toEqual({ ok: false, error: "invalid" });
    expect(await login({ hotelCode: "no-such-hotel", email: mail, password: TEST_PASSWORD })).toEqual({ ok: false, error: "invalid" });
  });

  it("does not let Hotel A's staff sign in at Hotel B", async () => {
    const mail = email("cross");
    await createStaffUser(A.hotelId, { email: mail, role: "EMPLOYEE", departmentId: A.dept.id });
    expect(await signIn(B, mail)).toEqual({ ok: false, error: "invalid" });
  });

  it("refuses disabled accounts and suspended hotels", async () => {
    const mail = email("disabled");
    const user = await createStaffUser(A.hotelId, { email: mail, role: "EMPLOYEE", departmentId: A.dept.id });
    const { token } = await actorFor(A, mail);
    await adminDb.staffUser.update({ where: { id: user.id }, data: { status: "DISABLED" } });
    expect((await signIn(A, mail)).ok).toBe(false);
    expect(await getActor(token)).toBeNull(); // existing session dies too

    const C = await createHotelWithData("suspended");
    const mailC = email("susp");
    await createStaffUser(C.hotelId, { email: mailC, role: "EMPLOYEE", departmentId: C.dept.id });
    const live = await actorFor(C, mailC);
    await adminDb.hotel.update({ where: { id: C.hotelId }, data: { status: "SUSPENDED" } });
    expect((await signIn(C, mailC)).ok).toBe(false);
    expect(await getActor(live.token)).toBeNull();
  });

  it(`locks the account after ${MAX_FAILED_ATTEMPTS} wrong passwords, even for the right one`, async () => {
    const mail = email("lock");
    const user = await createStaffUser(A.hotelId, { email: mail, role: "EMPLOYEE", departmentId: A.dept.id });
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
      expect(await signIn(A, mail, "wrong-password-1")).toEqual({ ok: false, error: "invalid" });
    }
    expect(await signIn(A, mail, "wrong-password-1")).toEqual({ ok: false, error: "locked" });
    expect(await signIn(A, mail)).toEqual({ ok: false, error: "locked" });
    // After the lock expires, sign-in works again.
    await adminDb.staffUser.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await signIn(A, mail)).ok).toBe(true);
    const actions = (await adminDb.auditLog.findMany({ where: { entityId: user.id } })).map((a) => a.action);
    expect(actions).toContain("auth.locked");
    expect(actions).toContain("auth.login_failed");
  });

  it("resets the failure count after a successful sign-in", async () => {
    const mail = email("reset");
    const user = await createStaffUser(A.hotelId, { email: mail, role: "EMPLOYEE", departmentId: A.dept.id });
    await signIn(A, mail, "wrong-password-1");
    await signIn(A, mail);
    expect((await adminDb.staffUser.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(0);
  });

  it("rejects expired, unknown and logged-out sessions", async () => {
    const mail = email("sess");
    await createStaffUser(A.hotelId, { email: mail, role: "EMPLOYEE", departmentId: A.dept.id });
    const one = await actorFor(A, mail);
    await adminDb.staffSession.updateMany({ where: { id: one.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await getActor(one.token)).toBeNull();
    expect(await getActor("made-up-token")).toBeNull();
    expect(await getActor(undefined)).toBeNull();

    const two = await actorFor(A, mail);
    await logout(two.actor);
    expect(await getActor(two.token)).toBeNull();
  });
});

describe("temporary passwords", () => {
  it("forces a password change before anything else, then ends other sessions", async () => {
    const mail = email("temp");
    await createStaffUser(A.hotelId, { email: mail, role: "EMPLOYEE", departmentId: A.dept.id, mustChangePassword: true });
    const first = await signIn(A, mail);
    expect(first).toMatchObject({ ok: true, next: "change-password" });
    const other = await actorFor(A, mail);
    const { actor, token } = await actorFor(A, mail);

    expect(await changePassword(actor, { currentPassword: "wrong-one-123", newPassword: "Brand-New-Pass-9" })).toMatchObject({ ok: false });
    expect(await changePassword(actor, { currentPassword: TEST_PASSWORD, newPassword: "short1" })).toMatchObject({ ok: false });
    expect(await changePassword(actor, { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD })).toMatchObject({ ok: false });
    expect(await changePassword(actor, { currentPassword: TEST_PASSWORD, newPassword: "Brand-New-Pass-9" })).toEqual({ ok: true });

    expect((await getActor(token))?.mustChangePassword).toBe(false);
    expect(await getActor(other.token)).toBeNull();
    expect((await signIn(A, mail)).ok).toBe(false);
    expect(await signIn(A, mail, "Brand-New-Pass-9")).toMatchObject({ ok: true, next: "home" });
  });
});

describe("2-step verification for GM and Hotel Admin", () => {
  it("requires setup on first sign-in and a code on every sign-in after", async () => {
    const mail = email("admin");
    const user = await createStaffUser(A.hotelId, { email: mail, role: "HOTEL_ADMIN" });
    const first = await signIn(A, mail);
    expect(first).toMatchObject({ ok: true, next: "mfa-setup" });
    let { actor, token } = await actorFor(A, mail);
    expect(can(actor, "settings.manage")).toBe(false); // password alone is not enough

    const { secret, uri } = await beginMfaSetup(actor);
    expect(uri).toContain(`secret=${secret}`);
    const stored = (await adminDb.staffUser.findUniqueOrThrow({ where: { id: user.id } })).mfaSecret!;
    expect(stored).not.toContain(secret); // encrypted at rest

    expect(await confirmMfaSetup(actor, "000000")).toMatchObject({ ok: false });
    expect(await confirmMfaSetup(actor, totpAt(secret, Date.now() / 1000))).toEqual({ ok: true });
    actor = (await getActor(token))!;
    expect(actor).toMatchObject({ mfaEnrolled: true, mfaVerified: true });
    expect(can(actor, "settings.manage")).toBe(true);

    // Next sign-in: password gets a session, but no permissions until the code is entered.
    const second = await signIn(A, mail);
    expect(second).toMatchObject({ ok: true, next: "mfa" });
    ({ actor, token } = await actorFor(A, mail));
    expect(can(actor, "settings.manage")).toBe(false);
    expect(await verifyMfa(actor, "000000")).toMatchObject({ ok: false });
    expect(await verifyMfa(actor, totpAt(secret, Date.now() / 1000))).toEqual({ ok: true });
    expect(can((await getActor(token))!, "settings.manage")).toBe(true);
    await expect(beginMfaSetup((await getActor(token))!)).rejects.toThrow(); // can't silently re-enrol
  });

  it("locks the account after repeated wrong codes and ends the session", async () => {
    const mail = email("gm");
    await createStaffUser(A.hotelId, { email: mail, role: "GM" });
    const setup = await actorFor(A, mail);
    const { secret } = await beginMfaSetup(setup.actor);
    await confirmMfaSetup(setup.actor, totpAt(secret, Date.now() / 1000));

    const { actor, token } = await actorFor(A, mail);
    let last;
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) last = await verifyMfa(actor, "000000");
    expect(last).toMatchObject({ ok: false, locked: true });
    expect(await getActor(token)).toBeNull();
    expect(await signIn(A, mail)).toEqual({ ok: false, error: "locked" });
  });

  it("does not ask employees and supervisors for a code", async () => {
    const mail = email("sup");
    await createStaffUser(A.hotelId, { email: mail, role: "SUPERVISOR", departmentId: A.dept.id });
    expect(await signIn(A, mail)).toMatchObject({ ok: true, next: "home" });
  });
});
