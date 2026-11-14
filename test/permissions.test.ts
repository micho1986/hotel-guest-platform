import { describe, expect, it } from "vitest";
import type { StaffRole } from "@/generated/prisma/enums";
import { can, isFullySignedIn, type Actor } from "@/server/auth/permissions";

function actorWith(role: StaffRole, over: Partial<Actor> = {}): Actor {
  return {
    staffId: "00000000-0000-4000-8000-000000000001",
    hotelId: "00000000-0000-4000-8000-000000000002",
    sessionId: "00000000-0000-4000-8000-000000000003",
    name: "Test",
    email: "test@example.com",
    memberships: [{ role, departmentId: null }],
    mfaEnrolled: false,
    mfaVerified: false,
    mustChangePassword: false,
    ...over,
  };
}

describe("front-desk role", () => {
  it("front desk can manage stays but not settings", () => {
    const actor = actorWith("FRONT_DESK");
    expect(can(actor, "stays.manage")).toBe(true);
    expect(can(actor, "stays.view")).toBe(true);
    expect(can(actor, "settings.view")).toBe(false);
  });

  it("front desk does not need MFA", () => {
    const actor = actorWith("FRONT_DESK", { mfaEnrolled: false, mfaVerified: false });
    expect(isFullySignedIn(actor)).toBe(true);
  });

  it("employees cannot check guests in", () => {
    expect(can(actorWith("EMPLOYEE"), "stays.manage")).toBe(false);
  });
});
