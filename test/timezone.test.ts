import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantDb, tenantTransaction } from "@/server/db";
import { adminDb, createHotelWithData, createStaffUser } from "./fixtures";

/**
 * Prisma's pg adapter sends a Date as UTC wall-clock text with no offset, and reads timestamptz by
 * relabelling the session's offset as +00:00. Both are only right when the session time zone is UTC.
 * On a machine or server whose Postgres runs in another zone (Asia/Dubai here), app-written times and
 * database-generated times (now(), column defaults) would disagree by the offset; alert windows compare them.
 */
const SAME_INSTANT_MS = 1000;

let hotelId: string;
let staffId: string;

beforeAll(async () => {
  const h = await createHotelWithData("timezone");
  hotelId = h.hotelId;
  staffId = (await createStaffUser(hotelId, { email: "tz@timezone.test", role: "SUPERVISOR", departmentId: h.dept.id })).id;
});

afterAll(async () => {
  await adminDb.$disconnect();
});

describe("timestamps are one instant whoever writes them", () => {
  it("a database-generated time and an app Date written together read back as the same instant (app client)", async () => {
    const appNow = new Date();

    // created_at comes from the column default (database now()); read_at is the app's Date.
    await tenantTransaction(hotelId, (tx) =>
      tx.$executeRaw`INSERT INTO notifications (id, hotel_id, recipient_staff_id, type, read_at)
                     VALUES (gen_random_uuid(), ${hotelId}::uuid, ${staffId}::uuid, 'TZ_APP', ${appNow})`,
    );
    const row = await tenantDb(hotelId).notification.findFirstOrThrow({ where: { type: "TZ_APP" } });

    expect(Math.abs(row.readAt!.getTime() - appNow.getTime())).toBeLessThan(SAME_INSTANT_MS);
    expect(Math.abs(row.createdAt.getTime() - appNow.getTime())).toBeLessThan(SAME_INSTANT_MS);
  });

  it("the same holds on the admin connection used by the alert job, seed and scripts", async () => {
    const appNow = new Date();

    await adminDb.$executeRaw`INSERT INTO notifications (id, hotel_id, recipient_staff_id, type, read_at)
                              VALUES (gen_random_uuid(), ${hotelId}::uuid, ${staffId}::uuid, 'TZ_ADMIN', ${appNow})`;
    const row = await adminDb.notification.findFirstOrThrow({ where: { hotelId, type: "TZ_ADMIN" } });

    expect(Math.abs(row.readAt!.getTime() - appNow.getTime())).toBeLessThan(SAME_INSTANT_MS);
    expect(Math.abs(row.createdAt.getTime() - appNow.getTime())).toBeLessThan(SAME_INSTANT_MS);
  });
});
