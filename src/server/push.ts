import "server-only";
import { z } from "zod";
import webPush from "web-push";
import { isFullySignedIn, type Actor } from "@/server/auth/permissions";
import { isUniqueViolation } from "@/server/admin/common";
import { tenantDb } from "@/server/db";
import { fail, ok, type ActionResult } from "@/server/forms";
import { DEFAULT_LOCALE } from "@/i18n";

/** Push services answer these when a device has unsubscribed or expired: forget the device. */
const GONE_STATUSES = new Set([404, 410]);
/** How long the push service keeps an undelivered alert. An alert older than this is stale anyway. */
const ALERT_TTL_SECONDS = 15 * 60;

export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
export type AlertPayload = { title: string; body: string; url: string };

/** What a supervisor's phone shows for a request alert: reference and room only, never the guest's name. */
export function requestAlertPayload(
  request: { id: string; publicRef: string; roomNumber: string },
  title: string,
): AlertPayload {
  return { title, body: `Room ${request.roomNumber}`, url: `/${DEFAULT_LOCALE}/staff/requests/${request.id}` };
}

/** Sends one payload to one device. Returns the push service's status instead of throwing on 4xx/5xx. */
export interface PushSender {
  send(target: PushTarget, payload: string): Promise<{ statusCode: number }>;
}

const subscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2048)
    .refine((u) => u.startsWith("https://"), "Push endpoints must use https."),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
});

/** Saves this browser's push subscription for the signed-in staff member. Saving it again is a no-op. */
export async function saveSubscription(actor: Actor, subscription: unknown): Promise<ActionResult> {
  if (!isFullySignedIn(actor)) return fail("Sign in first.");
  const parsed = subscriptionSchema.safeParse(subscription);
  if (!parsed.success) return fail("This browser sent an invalid push subscription.");
  const { endpoint, keys } = parsed.data;
  const device = { staffUserId: actor.staffId, p256dh: keys.p256dh, auth: keys.auth };
  try {
    await tenantDb(actor.hotelId).pushSubscription.upsert({
      where: { endpoint },
      create: { hotelId: actor.hotelId, endpoint, ...device },
      update: device, // a shared device alerts whoever enabled it last
    });
  } catch (e) {
    // The endpoint is registered in another hotel (RLS hides it, the unique index still sees it).
    if (isUniqueViolation(e)) return fail("This device is already registered elsewhere.");
    throw e;
  }
  return ok("Alerts are on for this device.");
}

/** The real sender, or null when VAPID keys are not configured (local development and tests). */
export function defaultPushSender(): PushSender | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return webPushSender({ publicKey, privateKey, subject });
}

export function webPushSender(vapid: { publicKey: string; privateKey: string; subject: string }): PushSender {
  return {
    async send(target, payload) {
      try {
        const res = await webPush.sendNotification(target, payload, { vapidDetails: vapid, TTL: ALERT_TTL_SECONDS });
        return { statusCode: res.statusCode };
      } catch (e) {
        if (e instanceof webPush.WebPushError) return { statusCode: e.statusCode };
        throw e;
      }
    },
  };
}

/**
 * Sends an alert to every device of one staff member and forgets devices the push service reports gone.
 * Best effort: a failing device is logged and skipped, never thrown, so an alert still lands in the
 * notification list when push fails. The payload must not contain guest names.
 */
export async function sendAlertPush(
  hotelId: string,
  staffId: string,
  payload: AlertPayload,
  sender: PushSender | null = defaultPushSender(),
): Promise<{ sent: number; removed: number }> {
  if (!sender) return { sent: 0, removed: 0 };
  const db = tenantDb(hotelId);
  const devices = await db.pushSubscription.findMany({
    where: { staffUserId: staffId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  const body = JSON.stringify(payload);

  const outcomes = await Promise.all(
    devices.map(async (d) => {
      try {
        const { statusCode } = await sender.send({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, body);
        if (GONE_STATUSES.has(statusCode)) return { gone: d.id };
        if (statusCode >= 200 && statusCode < 300) return { sent: true };
        console.error("push: device rejected alert", { hotelId, staffId, deviceId: d.id, statusCode });
      } catch (e) {
        console.error("push: send failed", { hotelId, staffId, deviceId: d.id, error: e instanceof Error ? e.message : e });
      }
      return {};
    }),
  );

  const goneIds = outcomes.flatMap((o) => ("gone" in o && o.gone ? [o.gone] : []));
  if (goneIds.length > 0) await db.pushSubscription.deleteMany({ where: { id: { in: goneIds } } });
  return { sent: outcomes.filter((o) => "sent" in o).length, removed: goneIds.length };
}

/**
 * Pushes one alert to every recipient. Never throws: the alert's notification rows are already written,
 * and a push outage must not stop the alert job or undo a transfer.
 */
export async function pushAlertToRecipients(
  hotelId: string,
  recipientStaffIds: string[],
  payload: AlertPayload,
  sender: PushSender | null,
): Promise<void> {
  if (!sender) return;
  await Promise.all(
    recipientStaffIds.map((staffId) =>
      sendAlertPush(hotelId, staffId, payload, sender).catch((e: unknown) => {
        console.error("push: alert fan-out failed", { hotelId, staffId, error: e instanceof Error ? e.message : e });
      }),
    ),
  );
}
