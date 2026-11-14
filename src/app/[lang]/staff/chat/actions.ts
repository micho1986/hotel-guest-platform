"use server";

import { refresh } from "next/cache";
import { requireStaff } from "@/server/auth/session-cookie";
import { postChatMessage } from "@/server/chat";
import { formValues, type ActionResult } from "@/server/forms";

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** Posts to a department channel. The service checks membership against the database, not the session. */
export async function postMessageAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireStaff();
  const values = formValues(formData);
  const result = await postChatMessage(actor, text(values.channelId), text(values.body));
  if (result.ok) refresh();
  return result;
}
