import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDictionary, isLocale } from "@/i18n";
import { guestTokenFromParams, resolveGuestToken } from "@/server/guest";

// Guest links are private: never indexed, and no third-party scripts on these pages.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// Every guest page reads a per-guest token from the URL, so none of them can be prerendered.
export const instant = false;

/** Every guest page passes through here: an unknown, revoked or expired token is a plain 404. */
export default async function GuestLayout({ children, params }: LayoutProps<"/[lang]/g/[token]">) {
  // The token is request-time data: a guest page must never be prerendered or cached with someone's stay in it.
  await connection();
  const { lang, token } = await params;
  if (!isLocale(lang)) notFound();
  const tok = guestTokenFromParams(token);
  if (!tok || !(await resolveGuestToken(tok))) notFound();
  const t = getDictionary(lang);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-5 py-8">
      <nav className="flex items-center justify-between text-sm">
        <Link href={`/${lang}/g/${token}`} className="font-medium text-navy">{t.guest.services}</Link>
        <Link href={`/${lang}/g/${token}/requests`} className="text-navy underline">{t.guest.myRequests}</Link>
      </nav>
      {children}
    </main>
  );
}
