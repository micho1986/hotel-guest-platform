import "server-only";
import { cookies } from "next/headers";

const COOKIE = "front_desk_card";
const FIVE_MINUTES = 5 * 60;

/**
 * Carries a freshly issued guest token from the check-in or reissue action to the card page.
 * httpOnly and same-site, kept five minutes, and never placed in a URL. The card page still checks
 * the token against the stay's stored hash before printing anything.
 */
export async function setCardToken(stayId: string, token: string): Promise<void> {
  (await cookies()).set(COOKIE, `${stayId}.${token}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: FIVE_MINUTES,
  });
}

/** The token for this stay if the cookie holds one for it. Base64url tokens contain no dots. */
export async function readCardToken(stayId: string): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [sid, token] = raw.split(".");
  return sid === stayId && token ? token : null;
}
