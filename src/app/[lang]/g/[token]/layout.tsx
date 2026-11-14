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

/**
 * Every guest page passes through here. A malformed link is a plain 404. A well-formed link that no longer
 * resolves (checked out, revoked, expired or never issued) gets the same friendly message, so a guest is never
 * told whether a token ever existed.
 */
export default async function GuestLayout({ children, params }: LayoutProps<"/[lang]/g/[token]">) {
  // The token is request-time data: a guest page must never be prerendered or cached with someone's stay in it.
  await connection();
  const { lang, token } = await params;
  if (!isLocale(lang)) notFound();
  const tok = guestTokenFromParams(token);
  if (!tok) notFound();
  const t = getDictionary(lang);
  if (!(await resolveGuestToken(tok))) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-5 py-8">
        <p role="alert" className="rounded-2xl border border-soft-gray bg-white p-6 text-navy">{t.guest.inactive}</p>
      </main>
    );
  }

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
