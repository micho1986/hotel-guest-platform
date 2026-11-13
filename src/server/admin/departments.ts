import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/auth/permissions";
import { audit } from "@/server/audit";
import { fail, ok, type ActionResult } from "@/server/forms";
import { checkbox, dbFor, id, isUniqueViolation, requiredText } from "./common";

export const departmentCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,9}$/, "2–10 letters/digits, starting with a letter (e.g. HK, SPA)"),
  nameEn: requiredText(80),
  nameAr: requiredText(80),
});

export const departmentUpdateSchema = z.object({
  id,
  nameEn: requiredText(80),
  nameAr: requiredText(80),
  isActive: checkbox,
});

export async function listDepartments(actor: Actor) {
  return dbFor(actor, "settings.view").department.findMany({ orderBy: { code: "asc" } });
}

export async function createDepartment(actor: Actor, input: Record<string, unknown>): Promise<ActionResult> {
  const db = dbFor(actor, "settings.manage");
  const parsed = departmentCreateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  try {
    const dept = await db.department.create({ data: { hotelId: actor.hotelId, ...parsed.data } });
    await audit(db, actor.hotelId, { actorId: actor.staffId, action: "department.created", entity: "department", entityId: dept.id, diff: parsed.data });
    return ok(`Department ${dept.code} added.`);
  } catch (e) {
    if (isUniqueViolation(e)) return fail(`A department with code ${parsed.data.code} already exists.`);
    throw e;
  }
}

export async function updateDepartment(actor: Actor, input: Record<string, unknown>): Promise<ActionResult> {
  const db = dbFor(actor, "settings.manage");
  const parsed = departmentUpdateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const { id: deptId, ...data } = parsed.data;
  const res = await db.department.updateMany({ where: { id: deptId }, data });
  if (res.count === 0) return fail("Department not found.");
  await audit(db, actor.hotelId, { actorId: actor.staffId, action: "department.updated", entity: "department", entityId: deptId, diff: data });
  return ok("Department saved.");
}
