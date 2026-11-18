import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale } from "@/i18n";
import { guestTokenFromParams, listGuestCategories, resolveGuestToken } from "@/server/guest";

export default async function GuestHome({ params }: PageProps<"/[lang]/g/[token]">) {
  const { lang, token } = await params;
  if (!isLocale(lang)) notFound();
  const tok = guestTokenFromParams(token);
  const guest = tok ? await resolveGuestToken(tok) : null;
  if (!guest) notFound();
  const t = getDictionary(lang);
  const categories = await listGuestCategories(guest);
  const name = (c: { nameEn: string; nameAr: string }) => (lang === "ar" ? c.nameAr : c.nameEn);

  return (
    <>
      <h1 className="font-display text-2xl text-navy rtl:font-arabic">{t.guest.services}</h1>
      <p className="text-charcoal/80">{t.guest.intro}</p>
      <ul className="grid gap-3">
        {/* Ostro items are reached through In-Room Dining, so their categories and the empty room_service category are not listed here. */}
        {categories.filter((c) => !c.key.startsWith("ostro-") && c.key !== "room_service").map((c) => (
          <li key={c.id}>
            <Link href={`/${lang}/g/${token}/${c.key}`} className="block rounded-2xl border border-soft-gray bg-white p-5 font-medium text-navy shadow-sm hover:border-champagne-dark">
              {name(c)}
            </Link>
          </li>
        ))}
        <li>
          <Link href={`/${lang}/g/${token}/menu`} className="block rounded-2xl border border-soft-gray bg-white p-5 font-medium text-navy shadow-sm hover:border-champagne-dark">
            In-Room Dining
          </Link>
        </li>
      </ul>
    </>
  );
}
