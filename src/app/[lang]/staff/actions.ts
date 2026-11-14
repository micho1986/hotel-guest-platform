"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import * as catalogue from "@/server/admin/catalogue";
import * as departments from "@/server/admin/departments";
import * as hotel from "@/server/admin/hotel";
import * as rooms from "@/server/admin/rooms";
import * as staff from "@/server/admin/staff";
import * as stays from "@/server/admin/stays";
import { ForbiddenError, type Actor } from "@/server/auth/permissions";
import { changePassword, confirmMfaSetup, login, logout, verifyMfa } from "@/server/auth/service";
import { clearSessionCookie, currentActor, requestMeta, requireStaff, setSessionCookie, STAFF_BASE } from "@/server/auth/session-cookie";
import { setCardToken } from "@/server/front-desk-card";
import { fail, formValues, type ActionResult } from "@/server/forms";
import { saveSubscription } from "@/server/push";

/**
 * Server actions: thin wrappers that identify the caller, hand the raw form
 * values to a service (which checks permissions and validates), and refresh
 * the page. No business rules live here.
 */

const text = (v: unknown) => (typeof v === "string" ? v : "");
const NEXT_PATH = { home: STAFF_BASE, "change-password": `${STAFF_BASE}/password`, "mfa-setup": `${STAFF_BASE}/mfa`, mfa: `${STAFF_BASE}/mfa` };

// ── Sign-in flow ─────────────────────────────────────────────────────────────

export async function loginAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const v = formValues(formData);
  const result = await login(
    { hotelCode: text(v.hotelCode), email: text(v.email), password: text(v.password) },
    await requestMeta(),
  );
  if (!result.ok) {
    return fail(
      result.error === "locked"
        ? "This account is locked after too many attempts. Try again in 15 minutes, or ask your hotel admin to reset your password."
        : "Those details don't match. Check the hotel code, email and password.",
    );
  }
  await setSessionCookie(result.token, result.expiresAt);
  redirect(NEXT_PATH[result.next]);
}

export async function logoutAction(): Promise<void> {
  const actor = await currentActor();
  if (actor) await logout(actor, await requestMeta());
  await clearSessionCookie();
  redirect(`${STAFF_BASE}/login`);
}

export async function changePasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireStaff({ stage: "password" });
  const v = formValues(formData);
  if (text(v.newPassword) !== text(v.confirmPassword)) return fail("The two new passwords don't match.");
  const result = await changePassword(
    actor,
    { currentPassword: text(v.currentPassword), newPassword: text(v.newPassword) },
    await requestMeta(),
  );
  if (!result.ok) return fail(result.error);
  redirect(STAFF_BASE);
}

export async function mfaAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireStaff({ stage: "mfa" });
  const code = text(formValues(formData).code);
  const meta = await requestMeta();
  const result = actor.mfaEnrolled ? await verifyMfa(actor, code, meta) : await confirmMfaSetup(actor, code, meta);
  if (!result.ok) {
    if ("locked" in result && result.locked) {
      await clearSessionCookie();
      redirect(`${STAFF_BASE}/login`);
    }
    return fail(result.error);
  }
  redirect(STAFF_BASE);
}

// ── Admin settings ───────────────────────────────────────────────────────────

async function run(
  formData: FormData,
  service: (actor: Actor, values: Record<string, unknown>) => Promise<ActionResult>,
): Promise<ActionResult> {
  const actor = await requireStaff();
  try {
    const result = await service(actor, formValues(formData));
    if (result.ok) refresh();
    return result;
  } catch (e) {
    if (e instanceof ForbiddenError) return fail("You don't have permission to do that.");
    throw e;
  }
}

const on = (v: unknown) => v === "true";

// ── Front desk ───────────────────────────────────────────────────────────────

async function guarded(service: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await service();
  } catch (e) {
    if (e instanceof ForbiddenError) return fail("You don't have permission to do that.");
    throw e;
  }
}

/** Checks a guest in, then opens the room's QR card. The token travels in a short-lived cookie, never a URL. */
export async function checkInAction(_p: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireStaff({ permission: "stays.manage" });
  const result = await guarded(() => stays.checkInGuest(actor, formValues(formData)));
  if (!result.ok || !result.secret) return result;
  const stayId = await stays.stayIdForToken(actor, result.secret.value);
  if (!stayId) return fail("Checked in, but the card could not be opened. Find the guest in the stay list.");
  await setCardToken(stayId, result.secret.value);
  redirect(`${STAFF_BASE}/front-desk/stays/${stayId}/card`);
}

/** Issues a new link for a stay and opens its card. The old card stops working at once. */
export async function reissueTokenAction(_p: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireStaff({ permission: "stays.manage" });
  const values = formValues(formData);
  const stayId = String(values.stayId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(stayId)) return fail("Stay not found.");
  const result = await guarded(() => stays.reissueGuestToken(actor, values));
  if (!result.ok || !result.secret) return result;
  await setCardToken(stayId, result.secret.value);
  redirect(`${STAFF_BASE}/front-desk/stays/${stayId}/card`);
}

export async function checkOutAction(_p: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return run(formData, stays.checkOutGuest);
}

export async function updateHotelAction(_p: ActionResult | null, fd: FormData) {
  return run(fd, hotel.updateHotelProfile);
}
export async function createDepartmentAction(_p: ActionResult | null, fd: FormData) {
  return run(fd, departments.createDepartment);
}
export async function updateDepartmentAction(_p: ActionResult | null, fd: FormData) {
  return run(fd, departments.updateDepartment);
}
export async function addRoomsAction(_p: ActionResult | null, fd: FormData) {
  return run(fd, (a, v) => rooms.addRooms(a, text(v.lines)));
}
export async function setRoomActiveAction(_p: ActionResult | null, fd: FormData) {
  return run(fd, (a, v) => rooms.setRoomActive(a, text(v.id), on(v.active)));
}
export async function createStaffAction(_p: ActionResult | null, fd: FormData) {
  return run(fd, staff.createStaff);
}
export async function updateStaffRoleAction(_p: ActionResult | null, fd: FormData) {
  return run(fd, staff.updateStaffRole);
}
export async function setStaffActiveAction(_p: ActionResult | null, fd: FormData) {
  return run(fd, (a, v) => staff.setStaffActive(a, text(v.id), on(v.active)));
}
export async function resetStaffPasswordAction(_p: ActionResult | null, fd: FormData) {
  return run(fd, (a, v) => staff.resetStaffPassword(a, text(v.id)));
}
export async function resetStaffMfaAction(_p: ActionResult | null, fd: FormData) {
  return run(fd, (a, v) => staff.resetStaffMfa(a, text(v.id)));
}
export async function setCategoryActiveAction(_p: ActionResult | null, fd: FormData) {
  return run(fd, (a, v) => catalogue.setCategoryActive(a, text(v.id), on(v.active)));
}
export async function createServiceItemAction(_p: ActionResult | null, fd: FormData) {
  return run(fd, catalogue.createServiceItem);
}
export async function updateServiceItemAction(_p: ActionResult | null, fd: FormData) {
  return run(fd, catalogue.updateServiceItem);
}
export async function setServiceItemActiveAction(_p: ActionResult | null, fd: FormData) {
  return run(fd, (a, v) => catalogue.setServiceItemActive(a, text(v.id), on(v.active)));
}

// ── Alerts (M4) ──────────────────────────────────────────────────────────────

/**
 * Called after the browser grants push permission, from the queue or staff home. Any fully signed-in staff
 * member may register a device: hotel admins receive fallback alerts but have no queue. The service
 * validates the subscription.
 */
export async function savePushSubscriptionAction(subscription: unknown): Promise<ActionResult> {
  const actor = await requireStaff();
  return saveSubscription(actor, subscription);
}
