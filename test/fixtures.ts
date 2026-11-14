import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { pgConfig } from "@/server/pg-connection";
import { generateAccessToken, hashAccessToken } from "@/server/tokens";

/** Admin client (bypasses RLS) — test fixtures only, like the seed and platform scripts. */
export const adminDb = new PrismaClient({
  adapter: new PrismaPg(pgConfig(process.env.DATABASE_ADMIN_URL!)),
});

/** A raw client as the runtime role (RLS applies) with NO app-layer scoping. */
export const rawAppDb = new PrismaClient({
  adapter: new PrismaPg(pgConfig(process.env.DATABASE_URL!)),
});

const DAY = 24 * 60 * 60 * 1000;
let counter = 0;

export async function createHotelWithData(label: string) {
  const n = ++counter;
  const hotel = await adminDb.hotel.create({ data: { name: `Test Hotel ${label}`, slug: `test-${label}-${n}-${Date.now()}` } });
  const hotelId = hotel.id;
  const dept = await adminDb.department.create({ data: { hotelId, code: "HK", nameEn: "Housekeeping", nameAr: "التدبير المنزلي" } });
  const room = await adminDb.room.create({ data: { hotelId, number: "202" } });
  const category = await adminDb.serviceCategory.create({ data: { hotelId, key: "amenities", nameEn: "Amenities", nameAr: "مستلزمات" } });
  const item = await adminDb.serviceItem.create({
    data: { hotelId, categoryId: category.id, departmentId: dept.id, nameEn: "Extra towels", nameAr: "مناشف إضافية", maxQty: 4 },
  });

  async function createStay(opts: { checkOutInDays?: number; revoked?: boolean } = {}) {
    const token = generateAccessToken();
    const stay = await adminDb.stay.create({
      data: {
        hotelId,
        roomId: room.id,
        guestDisplayName: `Guest ${label}`,
        checkIn: new Date(Date.now() - DAY),
        checkOut: new Date(Date.now() + (opts.checkOutInDays ?? 2) * DAY),
        accessTokenHash: hashAccessToken(token),
        tokenRevokedAt: opts.revoked ? new Date() : null,
      },
    });
    return { stay, token };
  }

  let ref = 0;
  async function createRequest(stayId: string | null) {
    return adminDb.request.create({
      data: {
        hotelId,
        publicRef: `HK-${1000 + ++ref}`,
        stayId,
        roomId: room.id,
        serviceItemId: item.id,
        departmentId: dept.id,
        qty: 2,
      },
    });
  }

  return { hotel, hotelId, dept, room, item, createStay, createRequest };
}

import { hashPassword } from "@/server/auth/passwords";
import type { StaffRole } from "@/generated/prisma/enums";

export const TEST_PASSWORD = "Correct-Horse-42";

/** A staff account with one role, created directly (as the platform script would). */
export async function createStaffUser(
  hotelId: string,
  opts: { email: string; role: StaffRole; departmentId?: string | null; mustChangePassword?: boolean },
) {
  const user = await adminDb.staffUser.create({
    data: {
      hotelId,
      email: opts.email,
      name: `Test ${opts.role}`,
      passwordHash: await hashPassword(TEST_PASSWORD),
      mustChangePassword: opts.mustChangePassword ?? false,
    },
  });
  await adminDb.staffMembership.create({
    data: { hotelId, staffUserId: user.id, role: opts.role, departmentId: opts.departmentId ?? null },
  });
  return user;
}
