import { NextResponse, type NextRequest } from "next/server";
import { isLocale, preferredLocale } from "@/i18n";

/** Sends a URL without a language prefix to /en/… or /ar/…, by browser language. */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isLocale(pathname.split("/")[1])) return;
  const lang = preferredLocale(request.headers.get("accept-language"));
  return NextResponse.redirect(new URL(`/${lang}${pathname === "/" ? "" : pathname}${search}`, request.url));
}

export const config = {
  // Skip Next internals, API routes and files with an extension (favicon.ico, images).
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
