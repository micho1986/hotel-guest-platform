/**
 * Platform setup: creates a hotel and its first Hotel Admin.
 *
 *   pnpm platform:create-hotel --name "Hotel Name" --slug hotel-code \
 *        --admin-name "Full Name" --admin-email admin@hotel.com [--timezone Asia/Dubai]
 *
 * Runs as the admin database role (DATABASE_ADMIN_URL). Prints a temporary
 * password once; the admin must change it and set up 2-step verification at
 * first sign-in. Everything else is configured from the Hotel settings screens.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
import { DEFAULT_CATEGORIES, DEFAULT_DEPARTMENTS } from "../../prisma/defaults";
import { PrismaClient } from "../../src/generated/prisma/client";
import { generateTemporaryPassword, hashPassword } from "../../src/server/auth/passwords";
import { pgConfig } from "../../src/server/pg-connection";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,49}$/, "3–50 chars: lowercase letters, digits, hyphens"),
  "admin-name": z.string().trim().min(2).max(80),
  "admin-email": z.string().trim().toLowerCase().pipe(z.email()),
  timezone: z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz), "Unknown time zone").default("Asia/Dubai"),
});

async function main() {
  const { values } = parseArgs({
    options: { name: { type: "string" }, slug: { type: "string" }, "admin-name": { type: "string" }, "admin-email": { type: "string" }, timezone: { type: "string" } },
  });
  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) console.error(`--${issue.path.join(".")}: ${issue.message}`);
    console.error('\nUsage: pnpm platform:create-hotel --name "Hotel Name" --slug hotel-code --admin-name "Full Name" --admin-email admin@hotel.com');
    process.exit(1);
  }
  const input = parsed.data;
  const db = new PrismaClient({ adapter: new PrismaPg(pgConfig(process.env.DATABASE_ADMIN_URL!)) });
  try {
    if (await db.hotel.findUnique({ where: { slug: input.slug } })) {
      console.error(`A hotel with code "${input.slug}" already exists.`);
      process.exit(1);
    }
    const tempPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(tempPassword);
    // One transaction: a hotel is never left half-created.
    await db.$transaction(async (tx) => {
      const hotel = await tx.hotel.create({ data: { name: input.name, slug: input.slug, timezone: input.timezone } });
      const hotelId = hotel.id;
      await tx.department.createMany({ data: DEFAULT_DEPARTMENTS.map((d) => ({ ...d, hotelId })) });
      await tx.serviceCategory.createMany({
        data: DEFAULT_CATEGORIES.map((c, sort) => ({ hotelId, key: c.key, nameEn: c.nameEn, nameAr: c.nameAr, icon: c.icon, sort, isActive: c.active })),
      });
      const admin = await tx.staffUser.create({
        data: { hotelId, name: input["admin-name"], email: input["admin-email"], passwordHash, mustChangePassword: true },
      });
      await tx.staffMembership.create({ data: { hotelId, staffUserId: admin.id, role: "HOTEL_ADMIN" } });
      await tx.auditLog.create({ data: { hotelId, action: "hotel.created", entity: "hotel", entityId: hotelId, diff: { by: "platform script" } } });
    });
    console.log(`Created "${input.name}".`);
    console.log(`  Hotel code:          ${input.slug}`);
    console.log(`  Admin email:         ${input["admin-email"]}`);
    console.log(`  Temporary password:  ${tempPassword}`);
    console.log("The admin signs in at /en/staff/login, chooses a password and sets up 2-step verification.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
