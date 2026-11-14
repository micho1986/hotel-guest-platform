"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { ForbiddenError, type Actor } from "@/server/auth/permissions";
import { requireStaff, STAFF_BASE } from "@/server/auth/session-cookie";
import { fail, formValues, type ActionResult } from "@/server/forms";
import { isUuid } from "@/server/ids";
import { MAX_PHOTO_BYTES, uploadRequestPhoto } from "@/server/requests/photos";
import * as requests from "@/server/requests/staff";
import * as supervisor from "@/server/requests/supervisor";
import { transferRequest } from "@/server/requests/transfer";

/**
 * Server actions for one request: each identifies the caller, checks the id, calls the service
 * (which checks the role, department and assignee), and refreshes the page when it changed something.
 */

const text = (v: unknown) => (typeof v === "string" ? v : "");

async function run(
  formData: FormData,
  service: (actor: Actor, requestId: string, values: Record<string, unknown>) => Promise<ActionResult>,
): Promise<ActionResult> {
  const actor = await requireStaff({ permission: "requests.view" });
  const values = formValues(formData);
  const requestId = text(values.requestId);
  if (!isUuid(requestId)) return fail("This request was not found.");
  try {
    const result = await service(actor, requestId, values);
    if (result.ok) refresh();
    return result;
  } catch (e) {
    if (e instanceof ForbiddenError) return fail("You don't have permission to do that.");
    throw e;
  }
}

export async function acceptAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return run(formData, (a, id) => requests.acceptRequest(a, id));
}

export async function rejectAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return run(formData, (a, id, v) => requests.rejectRequest(a, id, text(v.reason)));
}

export async function startAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return run(formData, (a, id) => requests.startRequest(a, id));
}

export async function waitAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return run(formData, (a, id, v) => requests.waitForGuest(a, id, text(v.reason)));
}

export async function resumeAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return run(formData, (a, id) => requests.resumeRequest(a, id));
}

export async function completeAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return run(formData, (a, id) => requests.completeRequest(a, id));
}

export async function noteAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return run(formData, (a, id, v) => requests.addInternalNote(a, id, text(v.note)));
}

// ── M4: supervisor and transfer ─────────────────────────────────────────────

export async function assignAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return run(formData, (a, id, v) => supervisor.assignRequest(a, id, text(v.staffId)));
}

export async function reassignAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return run(formData, (a, id, v) => supervisor.reassignRequest(a, id, text(v.staffId)));
}

export async function cancelAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return run(formData, (a, id, v) => supervisor.cancelStaffRequest(a, id, text(v.reason)));
}

/**
 * After a transfer the request belongs to another department and this page would no longer open for the
 * sender, so a success redirects to their queue instead of refreshing the page.
 */
export async function transferAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireStaff({ permission: "requests.view" });
  const values = formValues(formData);
  const requestId = text(values.requestId);
  if (!isUuid(requestId)) return fail("This request was not found.");
  let result: ActionResult;
  try {
    result = await transferRequest(actor, requestId, text(values.departmentId), text(values.reason));
  } catch (e) {
    if (e instanceof ForbiddenError) return fail("You don't have permission to do that.");
    throw e;
  }
  if (result.ok) redirect(`${STAFF_BASE}/requests?tab=new&transferred=1`);
  return result;
}

/** The photo is read as bytes, not through formValues, which drops files. Size is checked before reading it all. */
export async function photoAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireStaff({ permission: "requests.view" });
  const requestId = text(formData.get("requestId"));
  if (!isUuid(requestId)) return fail("This request was not found.");
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a photo first.");
  if (file.size > MAX_PHOTO_BYTES) return fail("Photos must be 5 MB or smaller.");
  try {
    const result = await uploadRequestPhoto(actor, requestId, Buffer.from(await file.arrayBuffer()));
    if (result.ok) refresh();
    return result;
  } catch (e) {
    if (e instanceof ForbiddenError) return fail("You don't have permission to do that.");
    throw e;
  }
}
