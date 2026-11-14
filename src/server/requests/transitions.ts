import "server-only";
import type { ActorType, RequestStatus } from "@/generated/prisma/enums";
import { tenantTransaction } from "@/server/db";

/** PRD §5 lifecycle. Escalation is a flag, not a status, so it is not here. */
export const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  SUBMITTED: ["RECEIVED", "CANCELLED"],
  RECEIVED: ["RECEIVED", "ACCEPTED", "CANCELLED"], // RECEIVED → RECEIVED is a rejection, recorded with its reason
  ACCEPTED: ["ACCEPTED", "IN_PROGRESS", "CANCELLED"], // ACCEPTED → ACCEPTED is a reassignment; → CANCELLED is a supervisor cancel (M4)
  IN_PROGRESS: ["WAITING_FOR_GUEST", "COMPLETED"],
  WAITING_FOR_GUEST: ["IN_PROGRESS"],
  COMPLETED: [],
  CANCELLED: [],
};

export type TransitionActor = { type: ActorType; id: string | null };

export type TransitionInput = {
  requestId: string;
  /** The statuses this change may start from. */
  from: RequestStatus[];
  to: RequestStatus;
  actor: TransitionActor;
  note?: string | null;
  isInternal?: boolean;
  /** Extra columns set in the same update, such as acceptedAt or assigneeId. */
  patch?: Record<string, unknown>;
  /**
   * Extra columns that must still hold their read value, such as the previous assigneeId. A change that
   * keeps the status (a reassignment) needs this, or two racing callers would both match on status.
   */
  match?: Record<string, unknown>;
};

export type TransitionResult = { ok: true } | { ok: false; message: string };

/**
 * The one place a request changes status. Inside one transaction it reads the current status, then
 * updates only if that status is still the one it read, then writes exactly one RequestEvent. If two
 * callers race, the loser's update matches nothing and it writes no event.
 */
export async function applyTransition(hotelId: string, input: TransitionInput): Promise<TransitionResult> {
  const allowedFrom = input.from.filter((f) => TRANSITIONS[f].includes(input.to));
  if (allowedFrom.length === 0) return { ok: false, message: "This change is not allowed." };

  return tenantTransaction(hotelId, async (tx) => {
    const current = await tx.request.findFirst({
      where: { ...input.match, id: input.requestId, hotelId, status: { in: allowedFrom } },
      select: { status: true },
    });
    if (!current) return { ok: false, message: "This request has already changed." };

    const moved = await tx.request.updateMany({
      where: { ...input.match, id: input.requestId, hotelId, status: current.status },
      data: { status: input.to, ...input.patch },
    });
    if (moved.count !== 1) return { ok: false, message: "This request has already changed." };

    await tx.requestEvent.create({
      data: {
        hotelId,
        requestId: input.requestId,
        actorType: input.actor.type,
        actorId: input.actor.id,
        fromStatus: current.status,
        toStatus: input.to,
        note: input.note ?? null,
        isInternal: input.isInternal ?? false,
      },
    });
    return { ok: true };
  });
}
