import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveGuestToken } from "@/server/guest";
import { adminDb } from "./fixtures";

const run = promisify(execFile);
let output = "";

beforeAll(async () => {
  // The test database is rebuilt before each run, so the demo seed runs once here.
  const { stdout } = await run("npx", ["tsx", "prisma/seed.ts"], {
    env: { ...process.env, DATABASE_ADMIN_URL: process.env.TEST_DATABASE_ADMIN_URL },
    maxBuffer: 10 * 1024 * 1024,
  });
  output = stdout;
}, 180_000);

describe("demo seed", () => {
  it("creates a front-desk account with no department", async () => {
    const user = await adminDb.staffUser.findFirst({ where: { email: "frontdesk@demo.hotel" } });
    expect(user).not.toBeNull();
    const membership = await adminDb.staffMembership.findFirst({ where: { staffUserId: user!.id } });
    expect(membership?.role).toBe("FRONT_DESK");
    expect(membership?.departmentId).toBeNull();
  });

  it("the printed room-202 token resolves to an active guest stay", async () => {
    const token = output.match(/room 202, valid 3 days\): (\S+)/)?.[1];
    expect(token).toBeTruthy();
    const stay = await resolveGuestToken(token!);
    expect(stay).not.toBeNull();
  });
});
