import "server-only";
import { z } from "zod";
import { assertCan, type Actor, type Permission } from "@/server/auth/permissions";
import { tenantDb } from "@/server/db";

/** Checks the permission, then returns the actor's hotel-scoped database. */
export function dbFor(actor: Actor, permission: Permission) {
  assertCan(actor, permission);
  return tenantDb(actor.hotelId);
}

/** HTML checkbox → boolean ("on" when ticked, absent when not). */
export const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

/** Optional text field → trimmed string or null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const requiredText = (max: number) => z.string().trim().min(1, "Required").max(max);

export const id = z.uuid("Invalid id");

/** Postgres unique-constraint violation (Prisma P2002), however the adapter reports it. */
export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; message?: string; cause?: { code?: string } };
  return err?.code === "P2002" || err?.cause?.code === "23505" || /Unique constraint/i.test(err?.message ?? "");
}
