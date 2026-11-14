import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale } from "@/i18n";
import { guestTokenFromParams, listGuestRequests, resolveGuestToken } from "@/server/guest";

export default async function GuestRequests({ params }: PageProps<"/[lang]/g/[token]/requests">) {
  const { lang, token } = await params;
  if (!isLocale(lang)) notFound();
  const tok = guestTokenFromParams(token);
  const guest = tok ? await resolveGuestToken(tok) : null;
  if (!guest) notFound();
  const t = getDictionary(lang);
  const rows = await listGuestRequests(guest);

  return (
    <>
      <h1 className="font-display text-2xl text-navy rtl:font-arabic">{t.guest.myRequests}</h1>
      {rows.length === 0 ? (
        <p className="text-charcoal/80">{t.guest.noRequests}</p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/${lang}/g/${token}/requests/${r.id}`} className="flex items-center justify-between rounded-2xl border border-soft-gray bg-white p-5 shadow-sm hover:border-champagne-dark">
                <span>
                  <span className="block font-medium text-navy">{lang === "ar" ? r.serviceItem.nameAr : r.serviceItem.nameEn}</span>
                  <span className="block font-mono text-xs text-charcoal/60">{r.publicRef}</span>
                </span>
                <span className="text-sm text-charcoal/80">{t.guest.statuses[r.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
