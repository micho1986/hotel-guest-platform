import type { Priority, RequestStatus } from "@/generated/prisma/enums";

const MINUTE = 60_000;

/** How long a request may sit in New before the supervisor is alerted. Same rule for every department. */
export function alertWindowMs(priority: Priority): number {
  return priority === "URGENT" ? 5 * MINUTE : 10 * MINUTE;
}

/**
 * True when a New request is due for an alert. The clock starts at creation, or at the last alert,
 * so a request that was already alerted waits a full window before it is alerted again.
 */
export function isAlertDue(
  input: { priority: Priority; status: RequestStatus; createdAt: Date; alertedAt: Date | null },
  now: Date,
): boolean {
  if (input.status !== "RECEIVED") return false;
  const since = input.alertedAt ?? input.createdAt;
  return now.getTime() - since.getTime() >= alertWindowMs(input.priority);
}
