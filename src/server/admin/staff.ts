import "server-only";
import { z } from "zod";
import type { StaffRole } from "@/generated/prisma/enums";
import type { Actor } from "@/server/auth/permissions";
import { generateTemporaryPassword, hashPassword } from "@/server/auth/passwords";
import { audit } from "@/server/audit";
import type { TenantDb } from "@/server/db";
import { fail, ok, type ActionResult } from "@/server/forms";
import { dbFor, id, isUniqueViolation, optionalText, requiredText } from "./common";

const ROLES = ["EMPLOYEE", "SUPERVISOR", "GM", "HOTEL_ADMIN", "FRONT_DESK"] as const;
const DEPARTMENT_ROLES: StaffRole[] = ["EMPLOYEE", "SUPERVISOR"];

const roleFields = {
  role: z.enum(ROLES),
  departmentId: optionalText(40),
};

/** Employees and supervisors belong to a department; GM and Hotel Admin are hotel-wide. */
const roleRule = (v: { role: StaffRole; departmentId: string | null }) =>
  DEPARTMENT_ROLES.includes(v.role) ? v.departmentId !== null : v.departmentId === null;
const roleRuleMessage = { message: "Employees and supervisors need a department; GM and Hotel Admin must not have one." };

export const staffCreateSchema = z
  .object({ name: requiredText(80), email: z.string().trim().toLowerCase().max(160).pipe(z.email("Enter a valid email")), ...roleFields })
  .refine(roleRule, roleRuleMessage);

export const staffRoleSchema = z.object({ staffId: id, ...roleFields }).refine(roleRule, roleRuleMessage);

export async function listStaff(actor: Actor) {
  return dbFor(actor, "settings.view").staffUser.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    include: { memberships: { include: { department: { select: { code: true, nameEn: true } } } } },
  });
}

async function checkDepartment(db: TenantDb, departmentId: string | null): Promise<string | null> {
  if (departmentId === null) return null;
  if (!id.safeParse(departmentId).success) return "Department not found.";
  const dept = await db.department.findFirst({ where: { id: departmentId, isActive: true } });
  return dept ? null : "Department not found or inactive.";
}

/** Active hotel admins other than `excludeId` — the hotel must never be left with none. */
async function otherActiveAdmins(db: TenantDb, excludeId: string): Promise<number> {
  return db.staffMembership.count({
    where: { role: "HOTEL_ADMIN", staffUserId: { not: excludeId }, staffUser: { status: "ACTIVE", deletedAt: null } },
  });
}

async function findStaff(db: TenantDb, staffId: string) {
  if (!id.safeParse(staffId).success) return null;
  return db.staffUser.findFirst({ where: { id: staffId, deletedAt: null }, include: { memberships: true } });
}

/** New account with a one-time temporary password, which must be changed at first sign-in. */
export async function createStaff(actor: Actor, input: Record<string, unknown>): Promise<ActionResult> {
  const db = dbFor(actor, "settings.manage");
  const parsed = staffCreateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const { name, email, role, departmentId } = parsed.data;
  const deptProblem = await checkDepartment(db, departmentId);
  if (deptProblem) return fail(deptProblem);

  const tempPassword = generateTemporaryPassword();
  try {
    const user = await db.staffUser.create({
      data: { hotelId: actor.hotelId, name, email, passwordHash: await hashPassword(tempPassword), mustChangePassword: true },
    });
    await db.staffMembership.create({ data: { hotelId: actor.hotelId, staffUserId: user.id, role, departmentId } });
    await audit(db, actor.hotelId, { actorId: actor.staffId, action: "staff.created", entity: "staff_user", entityId: user.id, diff: { email, role, departmentId } });
  } catch (e) {
    if (isUniqueViolation(e)) return fail(`${email} already has an account at this hotel.`);
    throw e;
  }
  return ok(`Account created for ${name}. Give them this temporary password; they'll choose their own at first sign-in.`, {
    label: "Temporary password (shown once)",
    value: tempPassword,
  });
}

/** One role per person in the MVP: replaces their memberships. */
export async function updateStaffRole(actor: Actor, input: Record<string, unknown>): Promise<ActionResult> {
  const db = dbFor(actor, "settings.manage");
  const parsed = staffRoleSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const { staffId, role, departmentId } = parsed.data;
  if (staffId === actor.staffId) return fail("You can't change your own role. Ask another hotel admin.");
  const user = await findStaff(db, staffId);
  if (!user) return fail("Staff member not found.");
  const deptProblem = await checkDepartment(db, departmentId);
  if (deptProblem) return fail(deptProblem);

  await db.staffMembership.deleteMany({ where: { staffUserId: staffId } });
  await db.staffMembership.create({ data: { hotelId: actor.hotelId, staffUserId: staffId, role, departmentId } });
  // New permissions apply from their next sign-in.
  await db.staffSession.deleteMany({ where: { staffUserId: staffId } });
  await audit(db, actor.hotelId, { actorId: actor.staffId, action: "staff.role_changed", entity: "staff_user", entityId: staffId, diff: { role, departmentId } });
  return ok(`${user.name} is now ${role.replace("_", " ").toLowerCase()}.`);
}

export async function setStaffActive(actor: Actor, staffId: string, active: boolean): Promise<ActionResult> {
  const db = dbFor(actor, "settings.manage");
  if (staffId === actor.staffId) return fail("You can't disable your own account.");
  const user = await findStaff(db, staffId);
  if (!user) return fail("Staff member not found.");
  if (!active && user.memberships.some((m) => m.role === "HOTEL_ADMIN") && (await otherActiveAdmins(db, staffId)) === 0) {
    return fail("This is the hotel's only admin. Make someone else an admin first.");
  }
  await db.staffUser.update({ where: { id: staffId }, data: { status: active ? "ACTIVE" : "DISABLED" } });
  if (!active) await db.staffSession.deleteMany({ where: { staffUserId: staffId } });
  await audit(db, actor.hotelId, { actorId: actor.staffId, action: active ? "staff.enabled" : "staff.disabled", entity: "staff_user", entityId: staffId });
  return ok(active ? `${user.name} can sign in again.` : `${user.name} is disabled and signed out everywhere.`);
}

/** New temporary password; also unlocks the account and signs them out everywhere. */
export async function resetStaffPassword(actor: Actor, staffId: string): Promise<ActionResult> {
  const db = dbFor(actor, "settings.manage");
  if (staffId === actor.staffId) return fail("Change your own password from your account menu.");
  const user = await findStaff(db, staffId);
  if (!user) return fail("Staff member not found.");
  const tempPassword = generateTemporaryPassword();
  await db.staffUser.update({
    where: { id: staffId },
    data: { passwordHash: await hashPassword(tempPassword), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
  });
  await db.staffSession.deleteMany({ where: { staffUserId: staffId } });
  await audit(db, actor.hotelId, { actorId: actor.staffId, action: "staff.password_reset", entity: "staff_user", entityId: staffId });
  return ok(`Password reset for ${user.name}.`, { label: "Temporary password (shown once)", value: tempPassword });
}

/** For a lost phone: removes their authenticator so they set it up again at next sign-in. */
export async function resetStaffMfa(actor: Actor, staffId: string): Promise<ActionResult> {
  const db = dbFor(actor, "settings.manage");
  if (staffId === actor.staffId) return fail("Ask another hotel admin to reset your authenticator.");
  const user = await findStaff(db, staffId);
  if (!user) return fail("Staff member not found.");
  await db.staffUser.update({ where: { id: staffId }, data: { mfaSecret: null, mfaEnabledAt: null } });
  await db.staffSession.deleteMany({ where: { staffUserId: staffId } });
  await audit(db, actor.hotelId, { actorId: actor.staffId, action: "staff.mfa_reset", entity: "staff_user", entityId: staffId });
  return ok(`${user.name} will set up their authenticator again at next sign-in.`);
}
