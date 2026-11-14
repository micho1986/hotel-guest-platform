"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDictionary, isLocale } from "@/i18n";
import { fail, formValues, ok, type ActionResult } from "@/server/forms";
import { guestTokenFromParams, resolveGuestToken } from "@/server/guest";
import { cancelGuestRequest, rateGuestRequest } from "@/server/guest-requests";

/**
 * The guest is identified by resolving the token again, never by a hidden field alone. Service
 * messages are English, so a guest sees the dictionary's wording for any refusal instead.
 */

async function identify(formData: FormData) {
  const v = formValues(formData);
  const lang = typeof v.lang === "string" && isLocale(v.lang) ? v.lang : "en";
  const t = getDictionary(lang);
  const tok = guestTokenFromParams(String(v.token ?? ""));
  const guest = tok ? await resolveGuestToken(tok) : null;
  const requestId = String(v.requestId ?? "");
  if (!guest || !z.uuid().safeParse(requestId).success) return { t, guest: null, requestId, v };
  return { t, guest, requestId, v };
}

export async function cancelAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { t, guest, requestId } = await identify(formData);
  if (!guest) return fail(t.guest.inactive);
  const res = await cancelGuestRequest(guest, requestId);
  if (!res.ok) return fail(t.guest.cannotChange);
  refresh();
  return ok(t.guest.cancelledDone);
}

export async function rateAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { t, guest, requestId, v } = await identify(formData);
  if (!guest) return fail(t.guest.inactive);
  const comment = typeof v.comment === "string" ? v.comment : null;
  const res = await rateGuestRequest(guest, requestId, { rating: Number(v.rating), comment });
  if (!res.ok) return fail(t.guest.cannotChange);
  refresh();
  return ok(t.guest.rateThanks);
}
