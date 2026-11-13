import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/auth/permissions";
import { audit } from "@/server/audit";
import { fail, ok, type ActionResult } from "@/server/forms";
import { checkbox, dbFor, id, optionalText, requiredText } from "./common";

export const serviceItemSchema = z.object({
  categoryId: id,
  departmentId: id,
  nameEn: requiredText(80),
  nameAr: requiredText(80),
  descriptionEn: optionalText(300),
  descriptionAr: optionalText(300),
  maxQty: z.coerce.number().int().min(1).max(20),
  needsNote: checkbox,
  safetyCritical: checkbox,
});

export const serviceItemUpdateSchema = serviceItemSchema.extend({ id });

export async function listCatalogue(actor: Actor) {
  return dbFor(actor, "settings.view").serviceCategory.findMany({
    orderBy: { sort: "asc" },
    include: {
      items: {
        where: { deletedAt: null },
        orderBy: { nameEn: "asc" },
        include: { department: { select: { code: true } } },
      },
    },
  });
}

export async function setCategoryActive(actor: Actor, categoryId: string, isActive: boolean): Promise<ActionResult> {
  const db = dbFor(actor, "settings.manage");
  if (!id.safeParse(categoryId).success) return fail("Category not found.");
  const res = await db.serviceCategory.updateMany({ where: { id: categoryId }, data: { isActive } });
  if (res.count === 0) return fail("Category not found.");
  await audit(db, actor.hotelId, { actorId: actor.staffId, action: isActive ? "category.shown" : "category.hidden", entity: "service_category", entityId: categoryId });
  return ok(isActive ? "Category is now shown to guests." : "Category hidden from guests.");
}

/** Category and department must both belong to this hotel (and the department be active). */
async function checkRefs(db: ReturnType<typeof dbFor>, categoryId: string, departmentId: string): Promise<string | null> {
  const [category, department] = await Promise.all([
    db.serviceCategory.findFirst({ where: { id: categoryId } }),
    db.department.findFirst({ where: { id: departmentId, isActive: true } }),
  ]);
  if (!category) return "Category not found.";
  if (!department) return "Department not found or inactive.";
  return null;
}

export async function createServiceItem(actor: Actor, input: Record<string, unknown>): Promise<ActionResult> {
  const db = dbFor(actor, "settings.manage");
  const parsed = serviceItemSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const problem = await checkRefs(db, parsed.data.categoryId, parsed.data.departmentId);
  if (problem) return fail(problem);
  const item = await db.serviceItem.create({ data: { hotelId: actor.hotelId, ...parsed.data } });
  await audit(db, actor.hotelId, { actorId: actor.staffId, action: "service_item.created", entity: "service_item", entityId: item.id, diff: parsed.data });
  return ok(`"${item.nameEn}" added.`);
}

export async function updateServiceItem(actor: Actor, input: Record<string, unknown>): Promise<ActionResult> {
  const db = dbFor(actor, "settings.manage");
  const parsed = serviceItemUpdateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const { id: itemId, ...data } = parsed.data;
  const problem = await checkRefs(db, data.categoryId, data.departmentId);
  if (problem) return fail(problem);
  const res = await db.serviceItem.updateMany({ where: { id: itemId, deletedAt: null }, data });
  if (res.count === 0) return fail("Service not found.");
  await audit(db, actor.hotelId, { actorId: actor.staffId, action: "service_item.updated", entity: "service_item", entityId: itemId, diff: data });
  return ok(`"${data.nameEn}" saved.`);
}

export async function setServiceItemActive(actor: Actor, itemId: string, isActive: boolean): Promise<ActionResult> {
  const db = dbFor(actor, "settings.manage");
  if (!id.safeParse(itemId).success) return fail("Service not found.");
  const res = await db.serviceItem.updateMany({ where: { id: itemId, deletedAt: null }, data: { isActive } });
  if (res.count === 0) return fail("Service not found.");
  await audit(db, actor.hotelId, { actorId: actor.staffId, action: isActive ? "service_item.activated" : "service_item.deactivated", entity: "service_item", entityId: itemId });
  return ok(isActive ? "Service is available to guests." : "Service hidden from guests.");
}
