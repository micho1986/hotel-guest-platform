import "server-only";
import { audit } from "@/server/audit";
import { findHotelBySlug, resolveStaffSession, tenantDb } from "@/server/db";
import { generateAccessToken, hashAccessToken } from "@/server/tokens";
import { decryptSecret, encryptSecret } from "./encryption";
import { hashPassword, passwordProblem, verifyAgainstDummy, verifyPassword } from "./passwords";
import { requiresMfa, type Actor } from "./permissions";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";

/**
 * Staff authentication. Pure service functions: they take plain inputs and
 * return results; reading and writing the cookie happens in session-cookie.ts.
 */

export const SESSION_HOURS = 12; // one shift
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

export type RequestMeta = { ip?: string | null; userAgent?: string | null };
export type NextStep = "home" | "change-password" | "mfa-setup" | "mfa";
export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; next: NextStep }
  | { ok: false; error: "invalid" | "locked" };

const normaliseEmail = (email: string) => email.trim().toLowerCase();

/** Hotel code + email + password → a new session, or a deliberately vague error. */
export async function login(
  input: { hotelCode: string; email: string; password: string },
  meta: RequestMeta = {},
): Promise<LoginResult> {
  const hotel = await findHotelBySlug(input.hotelCode.trim());
  if (!hotel || hotel.status !== "ACTIVE") {
    await verifyAgainstDummy(input.password);
    return { ok: false, error: "invalid" };
  }

  const db = tenantDb(hotel.hotelId);
  const user = await db.staffUser.findFirst({
    where: { email: normaliseEmail(input.email), deletedAt: null },
    include: { memberships: { select: { role: true, departmentId: true } } },
  });
  if (!user) {
    await verifyAgainstDummy(input.password);
    return { ok: false, error: "invalid" };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) return { ok: false, error: "locked" };

  const passwordOk = await verifyPassword(user.passwordHash, input.password);
  if (!passwordOk || user.status !== "ACTIVE") {
    const locked = await recordFailure(db, hotel.hotelId, user.id, user.failedLoginCount, "auth.login_failed", meta);
    return { ok: false, error: locked ? "locked" : "invalid" };
  }

  await db.staffUser.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  const { token, expiresAt } = await createSession(hotel.hotelId, user.id, meta);
  await audit(db, hotel.hotelId, { actorId: user.id, action: "auth.login", entity: "staff_user", entityId: user.id, ip: meta.ip });

  let next: NextStep = "home";
  if (user.mustChangePassword) next = "change-password";
  else if (requiresMfa(user)) next = user.mfaEnabledAt ? "mfa" : "mfa-setup";
  return { ok: true, token, expiresAt, next };
}

/** Counts a failed attempt; locks the account at the limit. Returns true if now locked. */
async function recordFailure(
  db: ReturnType<typeof tenantDb>,
  hotelId: string,
  staffId: string,
  previousFailures: number,
  action: string,
  meta: RequestMeta,
): Promise<boolean> {
  const failures = previousFailures + 1;
  const lock = failures >= MAX_FAILED_ATTEMPTS;
  await db.staffUser.update({
    where: { id: staffId },
    data: lock
      ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) }
      : { failedLoginCount: failures },
  });
  if (lock) await db.staffSession.deleteMany({ where: { staffUserId: staffId } });
  await audit(db, hotelId, { actorId: staffId, action: lock ? "auth.locked" : action, entity: "staff_user", entityId: staffId, ip: meta.ip });
  return lock;
}

async function createSession(hotelId: string, staffUserId: string, meta: RequestMeta) {
  const token = generateAccessToken();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
  await tenantDb(hotelId).staffSession.create({
    data: {
      hotelId,
      staffUserId,
      tokenHash: hashAccessToken(token),
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    },
  });
  return { token, expiresAt };
}

/** Session cookie token → the signed-in staff member, or null. */
export async function getActor(token: string | undefined): Promise<Actor | null> {
  if (!token || token.length > 100) return null;
  const session = await resolveStaffSession(hashAccessToken(token));
  if (!session) return null;
  const user = await tenantDb(session.hotelId).staffUser.findUnique({
    where: { id: session.staffUserId },
    include: { memberships: { select: { role: true, departmentId: true } } },
  });
  if (!user) return null;
  return {
    staffId: user.id,
    hotelId: session.hotelId,
    sessionId: session.sessionId,
    name: user.name,
    email: user.email,
    memberships: user.memberships,
    mfaEnrolled: user.mfaEnabledAt !== null,
    mfaVerified: session.mfaVerifiedAt !== null,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function logout(actor: Actor, meta: RequestMeta = {}): Promise<void> {
  const db = tenantDb(actor.hotelId);
  await db.staffSession.deleteMany({ where: { id: actor.sessionId } });
  await audit(db, actor.hotelId, { actorId: actor.staffId, action: "auth.logout", entity: "staff_user", entityId: actor.staffId, ip: meta.ip });
}

export type SimpleResult = { ok: true } | { ok: false; error: string };

/** Changes the password; ends every other session of this user. */
export async function changePassword(
  actor: Actor,
  input: { currentPassword: string; newPassword: string },
  meta: RequestMeta = {},
): Promise<SimpleResult> {
  const db = tenantDb(actor.hotelId);
  const user = await db.staffUser.findUniqueOrThrow({ where: { id: actor.staffId } });
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) return { ok: false, error: "Current password is incorrect." };
  const problem = passwordProblem(input.newPassword);
  if (problem) return { ok: false, error: problem };
  if (input.newPassword === input.currentPassword) return { ok: false, error: "Choose a password you haven't used here." };

  await db.staffUser.update({
    where: { id: actor.staffId },
    data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false },
  });
  await db.staffSession.deleteMany({ where: { staffUserId: actor.staffId, NOT: { id: actor.sessionId } } });
  await audit(db, actor.hotelId, { actorId: actor.staffId, action: "auth.password_changed", entity: "staff_user", entityId: actor.staffId, ip: meta.ip });
  return { ok: true };
}

const ISSUER = "Hotel Guest Platform";

/**
 * Starts authenticator enrolment. The secret is stored encrypted and stays
 * pending until confirmed; reloading the setup page shows the same pending secret.
 */
export async function beginMfaSetup(actor: Actor): Promise<{ secret: string; uri: string }> {
  if (actor.mfaEnrolled) throw new Error("Authenticator already set up");
  const db = tenantDb(actor.hotelId);
  const user = await db.staffUser.findUniqueOrThrow({ where: { id: actor.staffId } });
  let secret: string;
  if (user.mfaSecret && !user.mfaEnabledAt) {
    secret = decryptSecret(user.mfaSecret);
  } else {
    secret = generateTotpSecret();
    await db.staffUser.update({ where: { id: actor.staffId }, data: { mfaSecret: encryptSecret(secret), mfaEnabledAt: null } });
  }
  return { secret, uri: otpauthUri(ISSUER, actor.email, secret) };
}

/** Finishes enrolment with the first code from the app; marks this session verified. */
export async function confirmMfaSetup(actor: Actor, code: string, meta: RequestMeta = {}): Promise<SimpleResult> {
  const db = tenantDb(actor.hotelId);
  const user = await db.staffUser.findUniqueOrThrow({ where: { id: actor.staffId } });
  if (user.mfaEnabledAt || !user.mfaSecret) return { ok: false, error: "Start the setup again." };
  if (!verifyTotp(decryptSecret(user.mfaSecret), code)) return { ok: false, error: "That code didn't match. Check the time on your phone and try the newest code." };

  await db.staffUser.update({ where: { id: actor.staffId }, data: { mfaEnabledAt: new Date() } });
  await db.staffSession.update({ where: { id: actor.sessionId }, data: { mfaVerifiedAt: new Date() } });
  await audit(db, actor.hotelId, { actorId: actor.staffId, action: "auth.mfa_enrolled", entity: "staff_user", entityId: actor.staffId, ip: meta.ip });
  return { ok: true };
}

/** The 6-digit check after password sign-in. Wrong codes count toward the lockout. */
export async function verifyMfa(actor: Actor, code: string, meta: RequestMeta = {}): Promise<SimpleResult & { locked?: boolean }> {
  const db = tenantDb(actor.hotelId);
  const user = await db.staffUser.findUniqueOrThrow({ where: { id: actor.staffId } });
  if (!user.mfaEnabledAt || !user.mfaSecret) return { ok: false, error: "Authenticator not set up." };

  if (!verifyTotp(decryptSecret(user.mfaSecret), code)) {
    const locked = await recordFailure(db, actor.hotelId, actor.staffId, user.failedLoginCount, "auth.mfa_failed", meta);
    return locked
      ? { ok: false, locked: true, error: `Too many wrong codes. Try again in ${LOCKOUT_MINUTES} minutes.` }
      : { ok: false, error: "That code didn't match." };
  }
  await db.staffUser.update({ where: { id: actor.staffId }, data: { failedLoginCount: 0 } });
  await db.staffSession.update({ where: { id: actor.sessionId }, data: { mfaVerifiedAt: new Date() } });
  await audit(db, actor.hotelId, { actorId: actor.staffId, action: "auth.mfa_verified", entity: "staff_user", entityId: actor.staffId, ip: meta.ip });
  return { ok: true };
}
