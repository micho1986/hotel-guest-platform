/**
 * Seeds one FICTIONAL demo hotel in Dubai. Every row is flagged is_demo = true
 * and the UI labels it as sample data. No real hotel, guest or staff data.
 *
 * Runs as the admin role (DATABASE_ADMIN_URL) because creating a hotel is a
 * platform action. Re-running is safe: it stops if the demo hotel exists.
 */
import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, StaffRole } from "../src/generated/prisma/client";
import { pgConfig } from "../src/server/pg-connection";
import { generateAccessToken, hashAccessToken } from "../src/server/tokens";
import { DEFAULT_CATEGORIES as categories, DEFAULT_DEPARTMENTS as departments } from "./defaults";

const DEMO_SLUG = "demo-azure-dunes-dubai";
const DEMO_PASSWORD = "DemoHotel!2026"; // demo accounts only — documented in README

const db = new PrismaClient({
  adapter: new PrismaPg(pgConfig(process.env.DATABASE_ADMIN_URL!)),
});

type Item = { cat: string; dept: string; nameEn: string; nameAr: string; maxQty?: number; needsNote?: boolean; safety?: boolean };
const items: Item[] = [
  { cat: "housekeeping", dept: "HK", nameEn: "Room cleaning", nameAr: "تنظيف الغرفة" },
  { cat: "housekeeping", dept: "HK", nameEn: "Turndown service", nameAr: "خدمة تجهيز السرير" },
  { cat: "amenities", dept: "HK", nameEn: "Extra towels", nameAr: "مناشف إضافية", maxQty: 4 },
  { cat: "amenities", dept: "HK", nameEn: "Extra pillows", nameAr: "وسائد إضافية", maxQty: 4 },
  { cat: "amenities", dept: "HK", nameEn: "Blanket", nameAr: "بطانية", maxQty: 2 },
  { cat: "amenities", dept: "HK", nameEn: "Toiletries", nameAr: "مستلزمات الحمام" },
  { cat: "amenities", dept: "HK", nameEn: "Drinking water", nameAr: "مياه للشرب", maxQty: 6 },
  { cat: "amenities", dept: "HK", nameEn: "Baby cot", nameAr: "سرير أطفال" },
  { cat: "maintenance", dept: "ENG", nameEn: "Air conditioning", nameAr: "التكييف", needsNote: true },
  { cat: "maintenance", dept: "ENG", nameEn: "Lighting", nameAr: "الإضاءة", needsNote: true },
  { cat: "maintenance", dept: "ENG", nameEn: "Plumbing", nameAr: "السباكة", needsNote: true },
  { cat: "maintenance", dept: "ENG", nameEn: "TV or Wi-Fi", nameAr: "التلفاز أو الإنترنت", needsNote: true },
  { cat: "maintenance", dept: "ENG", nameEn: "Electrical or safety hazard", nameAr: "خطر كهربائي أو خطر على السلامة", needsNote: true, safety: true },
  { cat: "laundry", dept: "LAUN", nameEn: "Laundry pickup", nameAr: "استلام الغسيل" },
  { cat: "laundry", dept: "LAUN", nameEn: "Pressing", nameAr: "كي الملابس" },
  { cat: "concierge", dept: "CONC", nameEn: "Ask the concierge", nameAr: "اسأل الكونسيرج", needsNote: true },
];

const staff = [
  { email: "gm@demo.hotel", name: "Demo General Manager", role: StaffRole.GM, dept: null },
  { email: "admin@demo.hotel", name: "Demo Hotel Administrator", role: StaffRole.HOTEL_ADMIN, dept: null },
  { email: "fo.supervisor@demo.hotel", name: "Demo Front Office Supervisor", role: StaffRole.SUPERVISOR, dept: "FO" },
  { email: "hk.supervisor@demo.hotel", name: "Demo Housekeeping Supervisor", role: StaffRole.SUPERVISOR, dept: "HK" },
  { email: "fb.supervisor@demo.hotel", name: "Demo F&B Supervisor", role: StaffRole.SUPERVISOR, dept: "FB" },
  { email: "eng.supervisor@demo.hotel", name: "Demo Engineering Supervisor", role: StaffRole.SUPERVISOR, dept: "ENG" },
  { email: "hk.attendant@demo.hotel", name: "Demo Room Attendant", role: StaffRole.EMPLOYEE, dept: "HK" },
  { email: "frontdesk@demo.hotel", name: "Demo Front Desk", role: StaffRole.FRONT_DESK, dept: null },
];

async function main() {
  if (await db.hotel.findUnique({ where: { slug: DEMO_SLUG } })) {
    console.log("Demo hotel already seeded. Run `pnpm db:reset` for a clean database.");
    return;
  }
  const isDemo = true;

  const hotel = await db.hotel.create({
    data: {
      name: "Azure Dunes Hotel Dubai (Sample)",
      slug: DEMO_SLUG,
      timezone: "Asia/Dubai",
      brandColors: { primary: "#14213D", accent: "#C9A96E" },
      isDemo,
    },
  });
  const hotelId = hotel.id;

  const dept: Record<string, string> = {};
  for (const d of departments) {
    dept[d.code] = (await db.department.create({ data: { ...d, hotelId, isDemo } })).id;
  }

  // 5 floors × 10 rooms: 101–110 … 501–510
  const rooms: { id: string; number: string }[] = [];
  for (let floor = 1; floor <= 5; floor++) {
    for (let n = 1; n <= 10; n++) {
      const number = `${floor}${String(n).padStart(2, "0")}`;
      rooms.push(await db.room.create({ data: { hotelId, number, floor: String(floor), isDemo } }));
    }
  }

  const cat: Record<string, string> = {};
  for (const [sort, c] of categories.entries()) {
    const row = await db.serviceCategory.create({
      data: { hotelId, key: c.key, nameEn: c.nameEn, nameAr: c.nameAr, icon: c.icon, sort, isActive: c.active, isDemo },
    });
    cat[c.key] = row.id;
  }
  for (const i of items) {
    await db.serviceItem.create({
      data: {
        hotelId,
        categoryId: cat[i.cat],
        departmentId: dept[i.dept],
        nameEn: i.nameEn,
        nameAr: i.nameAr,
        maxQty: i.maxQty ?? 1,
        needsNote: i.needsNote ?? false,
        safetyCritical: i.safety ?? false,
        isDemo,
      },
    });
  }

  // Demo SLA defaults — every value is editable per hotel in M4.
  for (const code of ["HK", "ENG", "LAUN", "CONC", "FO", "FB"]) {
    await db.slaRule.createMany({
      data: [
        { hotelId, departmentId: dept[code], priority: "NORMAL", acceptWithinMin: 5, completeWithinMin: 30, isDemo },
        { hotelId, departmentId: dept[code], priority: "URGENT", acceptWithinMin: 2, completeWithinMin: 15, isDemo },
      ],
    });
  }

  const passwordHash = await hash(DEMO_PASSWORD);
  for (const s of staff) {
    const user = await db.staffUser.create({
      data: { hotelId, email: s.email, name: s.name, passwordHash, isDemo },
    });
    await db.staffMembership.create({
      data: { hotelId, staffUserId: user.id, departmentId: s.dept ? dept[s.dept] : null, role: s.role, isDemo },
    });
  }

  await db.announcement.create({
    data: {
      hotelId,
      titleEn: "Welcome to Azure Dunes (sample)",
      titleAr: "مرحباً بكم في أزور ديونز (نموذج)",
      bodyEn: "This is a demonstration hotel. All content is sample data.",
      bodyAr: "هذا فندق تجريبي. جميع المحتويات بيانات نموذجية.",
      startsAt: new Date(),
      isDemo,
    },
  });

  // One active demo stay. The raw token is printed once and never stored.
  const token = generateAccessToken();
  const checkIn = new Date();
  const checkOut = new Date(checkIn.getTime() + 3 * 24 * 60 * 60 * 1000);
  await db.stay.create({
    data: {
      hotelId,
      roomId: rooms[11].id, // room 202
      guestDisplayName: "Demo Guest",
      checkIn,
      checkOut,
      accessTokenHash: hashAccessToken(token),
      isDemo,
    },
  });

  console.log(`Seeded "${hotel.name}": ${departments.length} departments, ${rooms.length} rooms, ${items.length} service items, ${staff.length} staff.`);
  console.log(`Demo staff password (all accounts): ${DEMO_PASSWORD}`);
  console.log(`Demo guest token (room 202, valid 3 days): ${token}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
