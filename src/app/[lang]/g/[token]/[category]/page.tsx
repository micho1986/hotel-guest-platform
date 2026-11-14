import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale } from "@/i18n";
import { guestTokenFromParams, listGuestCategories, resolveGuestToken } from "@/server/guest";

export default async function GuestCategory({ params }: PageProps<"/[lang]/g/[token]/[category]">) {
  const { lang, token, category } = await params;
  if (!isLocale(lang)) notFound();
  const tok = guestTokenFromParams(token);
  const guest = tok ? await resolveGuestToken(tok) : null;
  if (!guest) notFound();
  const t = getDictionary(lang);

  const cat = (await listGuestCategories(guest)).find((c) => c.key === category);
  if (!cat) notFound();
  const name = (x: { nameEn: string; nameAr: string }) => (lang === "ar" ? x.nameAr : x.nameEn);
  const description = (x: { descriptionEn: string | null; descriptionAr: string | null }) =>
    (lang === "ar" ? x.descriptionAr : x.descriptionEn) ?? "";

  return (
    <>
      <h1 className="font-display text-2xl text-navy rtl:font-arabic">{name(cat)}</h1>
      {cat.items.length === 0 ? (
        <p className="text-charcoal/80">{t.guest.noItems}</p>
      ) : (
        <ul className="grid gap-3">
          {cat.items.map((item) => (
            <li key={item.id}>
              <Link href={`/${lang}/g/${token}/${cat.key}/${item.id}`} className="block rounded-2xl border border-soft-gray bg-white p-5 shadow-sm hover:border-champagne-dark">
                <span className="block font-medium text-navy">{name(item)}</span>
                {description(item) && <span className="mt-1 block text-sm text-charcoal/70">{description(item)}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
