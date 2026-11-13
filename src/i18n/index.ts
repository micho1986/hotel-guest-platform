import { ar } from "./ar";
import { en, type Dictionary } from "./en";

export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function dirFor(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

/** Arabic if the browser's top language is Arabic, otherwise English. */
export function preferredLocale(acceptLanguage: string | null): Locale {
  const first = acceptLanguage?.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("ar") ? "ar" : DEFAULT_LOCALE;
}

export function getDictionary(locale: Locale): Dictionary {
  return locale === "ar" ? ar : en;
}

export type { Dictionary };
