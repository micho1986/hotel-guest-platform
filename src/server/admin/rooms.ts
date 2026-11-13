import "server-only";
import type { Actor } from "@/server/auth/permissions";
import { audit } from "@/server/audit";
import { fail, ok, type ActionResult } from "@/server/forms";
import { dbFor, id } from "./common";
import { parseRoomLines } from "./room-lines";

export async function listRooms(actor: Actor) {
  return dbFor(actor, "settings.view").room.findMany({
    where: { deletedAt: null },
    orderBy: [{ floor: "asc" }, { number: "asc" }],
  });
}

/** Adds rooms from bulk text. All-or-nothing: any problem means nothing is added. */
export async function addRooms(actor: Actor, text: string): Promise<ActionResult> {
  const db = dbFor(actor, "settings.manage");
  const { rooms, errors } = parseRoomLines(text);
  if (errors.length) return fail(errors.slice(0, 5).join(" · "));
  if (rooms.length === 0) return fail("Enter at least one room.");

  const existing = await db.room.findMany({ where: { number: { in: rooms.map((r) => r.number) } }, select: { number: true } });
  if (existing.length) {
    const list = existing.map((r) => r.number).slice(0, 10).join(", ");
    return fail(`Already exist: ${list}${existing.length > 10 ? "…" : ""}. Nothing was added.`);
  }
  await db.room.createMany({ data: rooms.map((r) => ({ hotelId: actor.hotelId, ...r })) });
  await audit(db, actor.hotelId, {
    actorId: actor.staffId,
    action: "rooms.added",
    entity: "room",
    diff: { count: rooms.length, first: rooms[0].number, last: rooms[rooms.length - 1].number },
  });
  return ok(`${rooms.length} room${rooms.length === 1 ? "" : "s"} added.`);
}

export async function setRoomActive(actor: Actor, roomId: string, isActive: boolean): Promise<ActionResult> {
  const db = dbFor(actor, "settings.manage");
  if (!id.safeParse(roomId).success) return fail("Room not found.");
  const res = await db.room.updateMany({ where: { id: roomId, deletedAt: null }, data: { isActive } });
  if (res.count === 0) return fail("Room not found.");
  await audit(db, actor.hotelId, { actorId: actor.staffId, action: isActive ? "room.activated" : "room.deactivated", entity: "room", entityId: roomId });
  return ok(isActive ? "Room activated." : "Room deactivated.");
}
