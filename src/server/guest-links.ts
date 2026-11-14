import "server-only";

/**
 * The public English and Arabic links printed on a room's QR card.
 * APP_ORIGIN is required in production so a card never points at localhost.
 */
export function guestLinks(token: string): { en: string; ar: string } {
  const origin = process.env.APP_ORIGIN;
  if (!origin && process.env.NODE_ENV === "production") throw new Error("APP_ORIGIN is not set");
  const base = (origin ?? "http://localhost:3000").replace(/\/+$/, "");
  return { en: `${base}/en/g/${token}`, ar: `${base}/ar/g/${token}` };
}
