import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/auth/permissions";
import { audit } from "@/server/audit";
import { fail, ok, type ActionResult } from "@/server/forms";
import { dbFor, optionalText, requiredText } from "./common";

const hexColor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #14213D");

export const hotelProfileSchema = z.object({
  name: requiredText(120),
  timezone: z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", "Unknown time zone"),
  logoUrl: optionalText(500).refine((v) => v === null || /^https:\/\//.test(v), "Logo URL must start with https://"),
  primaryColor: hexColor,
  accentColor: hexColor,
});

export async function getHotel(actor: Actor) {
  return dbFor(actor, "settings.view").hotel.findFirstOrThrow();
}

export async function updateHotelProfile(actor: Actor, input: Record<string, unknown>): Promise<ActionResult> {
  const db = dbFor(actor, "settings.manage");
  const parsed = hotelProfileSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const { name, timezone, logoUrl, primaryColor, accentColor } = parsed.data;
  await db.hotel.update({
    where: { id: actor.hotelId },
    data: { name, timezone, logoUrl, brandColors: { primary: primaryColor.toUpperCase(), accent: accentColor.toUpperCase() } },
  });
  await audit(db, actor.hotelId, { actorId: actor.staffId, action: "hotel.updated", entity: "hotel", entityId: actor.hotelId, diff: parsed.data });
  return ok("Hotel profile saved.");
}
