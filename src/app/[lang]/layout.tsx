import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { dirFor, isLocale, LOCALES } from "@/i18n";
import "../globals.css";

export const metadata: Metadata = {
  title: "Hotel Guest Experience Platform",
  description: "Guest requests and hotel operations, in English and Arabic.",
};

// The language is part of the URL (/en/…, /ar/…), so pages prerender per language.
export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return (
    <html lang={lang} dir={dirFor(lang)} className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
