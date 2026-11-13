/** What every form's server action returns to <ActionForm>. */
export type ActionResult =
  | { ok: true; message: string; secret?: { label: string; value: string } }
  | { ok: false; message: string };

export type FormAction = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

export const ok = (message: string, secret?: { label: string; value: string }): ActionResult => ({ ok: true, message, secret });
export const fail = (message: string): ActionResult => ({ ok: false, message });

/** FormData → plain text values (files and framework fields dropped). Services validate them. */
export function formValues(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("$ACTION") && typeof value === "string") values[key] = value;
  }
  return values;
}
