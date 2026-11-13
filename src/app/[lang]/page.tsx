import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale } from "@/i18n";

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = getDictionary(lang);
  const other = lang === "ar" ? "en" : "ar";

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center justify-between bg-navy px-6 py-4 text-ivory">
        <span className="text-sm tracking-widest text-champagne uppercase rtl:tracking-normal">{t.appName}</span>
        <Link href={`/${other}`} className="rounded-full border border-champagne px-4 py-1 text-sm hover:bg-navy-light">
          {t.switchLanguage}
        </Link>
      </header>

      <section className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-16">
        <h1 className="font-display text-4xl leading-tight text-navy rtl:font-arabic">{t.tagline}</h1>
        <p className="text-lg">{t.guestHint}</p>
        <Link href="/en/staff/login" className="rounded-2xl border border-soft-gray bg-white p-6 shadow-sm hover:border-champagne-dark">
          <p className="font-medium text-navy">{t.staffLogin}</p>
        </Link>
      </section>

      <footer className="border-t border-soft-gray px-6 py-4 text-center text-xs text-charcoal/60">{t.demoNotice}</footer>
    </main>
  );
}
