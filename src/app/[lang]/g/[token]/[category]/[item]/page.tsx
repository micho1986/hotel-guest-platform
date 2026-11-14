import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm } from "@/components/action-form";
import { input, label } from "@/components/ui";
import { getDictionary, isLocale } from "@/i18n";
import { guestTokenFromParams, getGuestItem, resolveGuestToken } from "@/server/guest";
import { submitRequestAction } from "../../actions";

export default async function GuestRequestForm({ params }: PageProps<"/[lang]/g/[token]/[category]/[item]">) {
  const { lang, token, item } = await params;
  if (!isLocale(lang)) notFound();
  const tok = guestTokenFromParams(token);
  const guest = tok ? await resolveGuestToken(tok) : null;
  if (!guest || !z.uuid().safeParse(item).success) notFound();
  const t = getDictionary(lang);

  const it = await getGuestItem(guest, item);
  if (!it) notFound();
  const name = lang === "ar" ? it.nameAr : it.nameEn;
  const quantities = Array.from({ length: it.maxQty }, (_, i) => i + 1);

  return (
    <>
      <h1 className="font-display text-2xl text-navy rtl:font-arabic">{name}</h1>
      <ActionForm action={submitRequestAction} submitLabel={t.guest.send} pendingLabel={t.guest.sending}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name="serviceItemId" value={it.id} />
        <label className={label} htmlFor="qty">{t.guest.quantity}</label>
        <select id="qty" name="qty" defaultValue="1" className={`${input} mb-4`}>
          {quantities.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <label className={label} htmlFor="guestNote">{t.guest.note}</label>
        <textarea
          id="guestNote"
          name="guestNote"
          required={it.needsNote}
          placeholder={t.guest.notePlaceholder}
          className={`${input} mb-4 h-32`}
        />
      </ActionForm>
    </>
  );
}
