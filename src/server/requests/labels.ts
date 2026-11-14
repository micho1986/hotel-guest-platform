import type { RequestStatus } from "@/generated/prisma/enums";

/** Staff-facing status words. Staff screens are English (see the M3 design, non-goals). */
export const STATUS_LABEL: Record<RequestStatus, string> = {
  SUBMITTED: "Submitted",
  RECEIVED: "New",
  ACCEPTED: "Accepted",
  IN_PROGRESS: "In progress",
  WAITING_FOR_GUEST: "Waiting for guest",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** Hotel time. Dubai has no daylight saving, so a fixed zone is correct for the pilot. */
export function formatHotelTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", dateStyle: "short", timeStyle: "short" }).format(date);
}
