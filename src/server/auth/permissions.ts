import type { StaffRole } from "@/generated/prisma/enums";

/** A signed-in staff member, as every service function receives them. */
export type Actor = {
  staffId: string;
  hotelId: string;
  sessionId: string;
  name: string;
  email: string;
  memberships: { role: StaffRole; departmentId: string | null }[];
  mfaEnrolled: boolean;
  mfaVerified: boolean;
  mustChangePassword: boolean;
};

/** Permissions from the roles matrix (MVP plan, section 5) that exist so far. */
export type Permission =
  | "settings.view"
  | "settings.manage"
  | "audit.view"
  | "stays.view"
  | "stays.manage"
  | "requests.view"
  | "requests.manage";

const GRANTS: Record<Permission, StaffRole[]> = {
  "settings.view": ["HOTEL_ADMIN", "GM"],
  "settings.manage": ["HOTEL_ADMIN"],
  "audit.view": ["HOTEL_ADMIN", "GM"],
  "stays.view": ["FRONT_DESK", "SUPERVISOR", "GM", "HOTEL_ADMIN"],
  "stays.manage": ["FRONT_DESK", "SUPERVISOR", "GM", "HOTEL_ADMIN"],
  // Hotel admin has no request screens (PRD §5); GM views all departments and acts on none.
  "requests.view": ["EMPLOYEE", "SUPERVISOR", "GM"],
  "requests.manage": ["EMPLOYEE", "SUPERVISOR"],
};

export function hasRole(actor: Pick<Actor, "memberships">, role: StaffRole): boolean {
  return actor.memberships.some((m) => m.role === role);
}

/** GM and Hotel Admin accounts must use a 6-digit authenticator code. */
export function requiresMfa(actor: Pick<Actor, "memberships">): boolean {
  return hasRole(actor, "GM") || hasRole(actor, "HOTEL_ADMIN");
}

/** Signed in, password changed if required, and 2-step code entered if required. */
export function isFullySignedIn(actor: Actor): boolean {
  return !actor.mustChangePassword && (!requiresMfa(actor) || actor.mfaVerified);
}

export function can(actor: Actor, permission: Permission): boolean {
  return isFullySignedIn(actor) && GRANTS[permission].some((role) => hasRole(actor, role));
}

export class ForbiddenError extends Error {
  constructor(permission: string) {
    super(`Not allowed: ${permission}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw new ForbiddenError(permission);
}
