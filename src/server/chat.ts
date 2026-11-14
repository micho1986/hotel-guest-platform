import "server-only";
import { isFullySignedIn, type Actor } from "@/server/auth/permissions";
import { tenantDb, type TenantDb } from "@/server/db";
import { fail, ok, type ActionResult } from "@/server/forms";
import { isUuid } from "@/server/ids";
import type { StaffRole } from "@/generated/prisma/enums";

export const CHAT_MAX_BODY = 2000;
/** Messages returned when the screen first opens; later polls ask only for what is newer. */
const CHAT_FIRST_PAGE = 50;
const CHAT_POLL_PAGE = 200;

/** Roles that may post in their own department's channel (the requests.manage roles). */
const POSTING_ROLES: StaffRole[] = ["EMPLOYEE", "SUPERVISOR"];
/** Roles that may read every channel of the hotel. */
const READ_ALL_ROLES: StaffRole[] = ["SUPERVISOR", "GM"];

export type ChatMessageView = { id: string; body: string; authorName: string; createdAt: Date };
export type ChatRead = { ok: true; messages: ChatMessageView[] } | { ok: false; message: string };

const NOT_FOUND = "This channel was not found.";
const NOT_ALLOWED = "You can't use this channel.";

/**
 * The actor's memberships as they are now in the database, not as the session saw them at sign-in,
 * so someone removed from a department loses the channel at once. Inactive or deleted staff have none.
 */
async function currentMemberships(db: TenantDb, actor: Actor) {
  return db.staffMembership.findMany({
    where: { staffUserId: actor.staffId, staffUser: { status: "ACTIVE", deletedAt: null } },
    select: { role: true, departmentId: true },
  });
}

async function findChannel(db: TenantDb, channelId: string) {
  if (!isUuid(channelId)) return null;
  return db.chatChannel.findFirst({ where: { id: channelId }, select: { id: true, departmentId: true } });
}

/** Read: members of the channel's department, every supervisor, and the GM. */
async function mayRead(db: TenantDb, actor: Actor, departmentId: string): Promise<boolean> {
  const memberships = await currentMemberships(db, actor);
  return memberships.some((m) => m.departmentId === departmentId || READ_ALL_ROLES.includes(m.role));
}

/** Post: employees and supervisors of the channel's own department. */
async function mayPost(db: TenantDb, actor: Actor, departmentId: string): Promise<boolean> {
  const memberships = await currentMemberships(db, actor);
  return memberships.some((m) => m.departmentId === departmentId && POSTING_ROLES.includes(m.role));
}

export async function postChatMessage(actor: Actor, channelId: string, body: string): Promise<ActionResult> {
  if (!isFullySignedIn(actor)) return fail(NOT_ALLOWED);
  const text = body.trim();
  if (!text) return fail("Write a message first.");
  if (text.length > CHAT_MAX_BODY) return fail(`Keep messages under ${CHAT_MAX_BODY} characters.`);

  const db = tenantDb(actor.hotelId);
  const channel = await findChannel(db, channelId);
  if (!channel) return fail(NOT_FOUND);
  if (!(await mayPost(db, actor, channel.departmentId))) return fail(NOT_ALLOWED);

  await db.chatMessage.create({
    data: { hotelId: actor.hotelId, channelId: channel.id, authorStaffId: actor.staffId, body: text },
  });
  return ok("Sent.");
}

/**
 * Messages in a channel, oldest first. Without sinceId: the latest page. With sinceId: only messages
 * after that one, ordered by (createdAt, id) so two messages in the same millisecond are not lost.
 */
export async function listChatMessages(actor: Actor, channelId: string, sinceId?: string): Promise<ChatRead> {
  if (!isFullySignedIn(actor)) return { ok: false, message: NOT_ALLOWED };
  const db = tenantDb(actor.hotelId);
  const channel = await findChannel(db, channelId);
  if (!channel) return { ok: false, message: NOT_FOUND };
  if (!(await mayRead(db, actor, channel.departmentId))) return { ok: false, message: NOT_ALLOWED };

  const select = { id: true, body: true, createdAt: true, author: { select: { name: true } } } as const;
  const since =
    sinceId && isUuid(sinceId)
      ? await db.chatMessage.findFirst({ where: { id: sinceId, channelId: channel.id }, select: { id: true, createdAt: true } })
      : null;

  const rows = since
    ? await db.chatMessage.findMany({
        where: {
          channelId: channel.id,
          OR: [{ createdAt: { gt: since.createdAt } }, { createdAt: since.createdAt, id: { gt: since.id } }],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: CHAT_POLL_PAGE,
        select,
      })
    : (
        await db.chatMessage.findMany({
          where: { channelId: channel.id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: CHAT_FIRST_PAGE,
          select,
        })
      ).toReversed();

  return {
    ok: true,
    messages: rows.map((r) => ({ id: r.id, body: r.body, authorName: r.author.name, createdAt: r.createdAt })),
  };
}
