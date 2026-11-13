import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getActor, type RequestMeta } from "./service";
import { can, requiresMfa, type Actor, type Permission } from "./permissions";

/** The only file that touches the staff session cookie. */

const COOKIE = "staff_session";
export const STAFF_BASE = "/en/staff";

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"),
    userAgent: h.get("user-agent"),
  };
}

/** The signed-in staff member for this request (looked up once per request). */
export const currentActor = cache(async (): Promise<Actor | null> => {
  return getActor((await cookies()).get(COOKIE)?.value);
});

/**
 * Page and action guard. Sends people to the step they still owe:
 * sign-in → password change (if required) → 2-step code (if required) → the page.
 * `stage` lets the password and 2-step pages themselves load mid-way.
 */
export async function requireStaff(
  opts: { stage?: "full" | "password" | "mfa"; permission?: Permission } = {},
): Promise<Actor> {
  const stage = opts.stage ?? "full";
  const actor = await currentActor();
  if (!actor) redirect(`${STAFF_BASE}/login`);
  if (stage !== "password" && actor.mustChangePassword) redirect(`${STAFF_BASE}/password`);
  if (stage === "full" && requiresMfa(actor) && !actor.mfaVerified) redirect(`${STAFF_BASE}/mfa`);
  if (opts.permission && !can(actor, opts.permission)) redirect(`${STAFF_BASE}?denied=1`);
  return actor;
}
