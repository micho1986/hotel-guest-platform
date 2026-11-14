"use server";

import { redirect } from "next/navigation";
import { getDictionary, isLocale } from "@/i18n";
import { fail, formValues, type ActionResult } from "@/server/forms";
import { guestTokenFromParams, resolveGuestToken } from "@/server/guest";
import { submitGuestRequest } from "@/server/guest-requests";

/**
 * The guest's token is read from the form, but the stay comes only from resolving it again.
 * Hidden fields are never trusted for who the guest is.
 */
export async function submitRequestAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const v = formValues(formData);
  const lang = typeof v.lang === "string" && isLocale(v.lang) ? v.lang : "en";
  const t = getDictionary(lang);

  const tok = guestTokenFromParams(String(v.token ?? ""));
  const guest = tok ? await resolveGuestToken(tok) : null;
  if (!tok || !guest) return fail(t.guest.inactive);

  const res = await submitGuestRequest(guest, {
    serviceItemId: String(v.serviceItemId ?? ""),
    qty: Number(v.qty),
    guestNote: typeof v.guestNote === "string" ? v.guestNote : null,
  });
  if (!res.ok || !res.requestId) return fail(res.message);

  redirect(`/${lang}/g/${tok}/requests/${res.requestId}`);
}
