import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDictionary, isLocale } from "@/i18n";
import { getGuestRequest, guestTokenFromParams, resolveGuestToken } from "@/server/guest";

export default async function GuestRequestDetail({ params }: PageProps<"/[lang]/g/[token]/requests/[requestId]">) {
  const { lang, token, requestId } = await params;
  if (!isLocale(lang)) notFound();
  const tok = guestTokenFromParams(token);
  const guest = tok ? await resolveGuestToken(tok) : null;
  if (!guest || !z.uuid().safeParse(requestId).success) notFound();
  const t = getDictionary(lang);

  const r = await getGuestRequest(guest, requestId);
  if (!r) notFound();
  const submitted = new Intl.DateTimeFormat(lang === "ar" ? "ar-AE" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dubai",
  }).format(r.createdAt);

  return (
    <>
      <h1 className="font-display text-2xl text-navy rtl:font-arabic">{t.guest.requestTitle}</h1>
      <dl className="grid gap-3 rounded-2xl border border-soft-gray bg-white p-5 shadow-sm">
        <div><dt className="text-xs text-charcoal/60">{t.guest.reference}</dt><dd className="font-mono font-semibold text-navy">{r.publicRef}</dd></div>
        <div><dt className="text-xs text-charcoal/60">{t.guest.status}</dt><dd>{t.guest.statuses[r.status]}</dd></div>
        <div><dt className="text-xs text-charcoal/60">{t.guest.submitted}</dt><dd>{submitted}</dd></div>
        {r.guestNote && <div><dt className="text-xs text-charcoal/60">{t.guest.note}</dt><dd>{r.guestNote}</dd></div>}
      </dl>
      <Link href={`/${lang}/g/${token}/requests`} className="text-sm text-navy underline">{t.guest.back}</Link>
    </>
  );
}
