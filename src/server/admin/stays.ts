import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/auth/permissions";
import { audit } from "@/server/audit";
import { fail, ok, type ActionResult } from "@/server/forms";
import { dbFor, id, isUniqueViolation, requiredText } from "./common";
import { newStayToken } from "./stay-token";

const checkInSchema = z
  .object({
    roomId: id,
    guestDisplayName: requiredText(120),
    checkIn: z.coerce.date(),
    checkOut: z.coerce.date(),
  })
  .refine((v) => v.checkOut > v.checkIn, { message: "Check-out must be after check-in", path: ["checkOut"] });

const stayIdSchema = z.object({ stayId: id });

const stayRowSelect = {
  id: true,
  guestDisplayName: true,
  status: true,
  checkIn: true,
  checkOut: true,
  tokenRevokedAt: true,
  room: { select: { number: true } },
} as const;

const TOKEN_LABEL = "Guest token (shown once)";

/** Checks a guest in. Returns the token once, in `secret`, for the QR card. */
export async function checkInGuest(actor: Actor, input: Record<string, unknown>): Promise<ActionResult> {
  const db = dbFor(actor, "stays.manage");
  const parsed = checkInSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;

  const room = await db.room.findFirst({ where: { id: v.roomId, deletedAt: null, isActive: true }, select: { id: true, number: true } });
  if (!room) return fail("Room not found.");
  const occupied = await db.stay.findFirst({ where: { roomId: v.roomId, status: "ACTIVE" }, select: { id: true } });
  if (occupied) return fail("This room already has a guest.");

  const { token, hash } = newStayToken();
  try {
    const stay = await db.stay.create({
      data: {
        hotelId: actor.hotelId,
        roomId: v.roomId,
        guestDisplayName: v.guestDisplayName,
        checkIn: v.checkIn,
        checkOut: v.checkOut,
        accessTokenHash: hash,
      },
    });
    await audit(db, actor.hotelId, { actorId: actor.staffId, action: "stay.checked_in", entity: "stay", entityId: stay.id, diff: { room: room.number } });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("This room already has a guest.");
    throw e;
  }
  return ok(`${v.guestDisplayName} checked in to room ${room.number}.`, { label: TOKEN_LABEL, value: token });
}

/** Replaces a stay's token. The old QR card stops working at once. */
export async function reissueGuestToken(actor: Actor, input: Record<string, unknown>): Promise<ActionResult> {
  const db = dbFor(actor, "stays.manage");
  const parsed = stayIdSchema.safeParse(input);
  if (!parsed.success) return fail("Stay not found.");
  const stay = await db.stay.findFirst({ where: { id: parsed.data.stayId }, select: { id: true, status: true } });
  if (!stay) return fail("Stay not found.");
  if (stay.status !== "ACTIVE") return fail("This stay has ended.");

  const { token, hash } = newStayToken();
  await db.stay.update({ where: { id: stay.id }, data: { accessTokenHash: hash } });
  await audit(db, actor.hotelId, { actorId: actor.staffId, action: "stay.token_reissued", entity: "stay", entityId: stay.id });
  return ok("New link created. The old QR card no longer works.", { label: TOKEN_LABEL, value: token });
}

/** Checks a guest out and revokes their link. */
export async function checkOutGuest(actor: Actor, input: Record<string, unknown>): Promise<ActionResult> {
  const db = dbFor(actor, "stays.manage");
  const parsed = stayIdSchema.safeParse(input);
  if (!parsed.success) return fail("Stay not found.");
  const stay = await db.stay.findFirst({ where: { id: parsed.data.stayId }, select: { id: true, status: true } });
  if (!stay) return fail("Stay not found.");
  if (stay.status !== "ACTIVE") return fail("This stay has ended.");

  await db.stay.update({ where: { id: stay.id }, data: { status: "CHECKED_OUT", tokenRevokedAt: new Date() } });
  await audit(db, actor.hotelId, { actorId: actor.staffId, action: "stay.checked_out", entity: "stay", entityId: stay.id });
  return ok("Guest checked out. Their link no longer works.");
}

export async function listStays(actor: Actor) {
  return dbFor(actor, "stays.view").stay.findMany({ select: stayRowSelect, orderBy: { checkIn: "desc" } });
}

export async function getStay(actor: Actor, stayId: string) {
  if (!id.safeParse(stayId).success) return null;
  return dbFor(actor, "stays.view").stay.findFirst({ where: { id: stayId }, select: stayRowSelect });
}
