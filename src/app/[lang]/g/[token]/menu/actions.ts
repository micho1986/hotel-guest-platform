"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDictionary, isLocale } from "@/i18n";
import { fail, formValues, type ActionResult } from "@/server/forms";
import { guestTokenFromParams, resolveGuestToken } from "@/server/guest";
import { placeServiceOrder } from "@/server/room-service/orders";

const linesSchema = z.array(z.object({ serviceItemId: z.string(), qty: z.number() })).max(50);

/**
 * The cart arrives as item ids and quantities only. Prices are read again on the server by placeServiceOrder,
 * and the stay comes only from resolving the token again.
 */
export async function placeOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const v = formValues(formData);
  const lang = typeof v.lang === "string" && isLocale(v.lang) ? v.lang : "en";

  const tok = guestTokenFromParams(String(v.token ?? ""));
  const guest = tok ? await resolveGuestToken(tok) : null;
  if (!tok || !guest) return fail(getDictionary(lang).guest.inactive);

  let raw: unknown;
  try {
    raw = JSON.parse(String(v.lines ?? "[]"));
  } catch {
    return fail("Your cart could not be read. Please try again.");
  }
  const parsed = linesSchema.safeParse(raw);
  if (!parsed.success) return fail("Your cart could not be read. Please try again.");

  const note = typeof v.guestNote === "string" ? v.guestNote.trim() : "";
  const res = await placeServiceOrder(guest, { lines: parsed.data, guestNote: note || null });
  if (!res.ok || !res.requestId) return fail(res.message);

  redirect(`/${lang}/g/${tok}/requests/${res.requestId}`);
}
