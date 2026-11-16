/**
 * Copies the Ostro menu (prisma/data/ostro-menu.sql) into one hotel's catalogue. Safe to run again.
 *
 *   pnpm menu:import-ostro --slug hotel-code
 *
 * Runs as the admin database role (DATABASE_ADMIN_URL). --slug may be omitted only if the database
 * holds exactly one hotel.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { pgConfig } from "../../src/server/pg-connection";
import { writeOstroMenu } from "../../src/server/room-service/ostro-import-core";
import { parseOstroMenu } from "../../src/server/room-service/ostro-menu";

async function main() {
  const { values } = parseArgs({ options: { slug: { type: "string" } } });
  const db = new PrismaClient({ adapter: new PrismaPg(pgConfig(process.env.DATABASE_ADMIN_URL!)) });
  try {
    const hotels = await db.hotel.findMany({ select: { id: true, slug: true } });
    const hotel = values.slug ? hotels.find((h) => h.slug === values.slug) : hotels.length === 1 ? hotels[0] : undefined;
    if (!hotel) {
      console.error(values.slug ? `No hotel with code "${values.slug}".` : `Pass --slug: the database has ${hotels.length} hotels.`);
      process.exit(1);
    }
    const menu = parseOstroMenu(readFileSync("prisma/data/ostro-menu.sql", "utf8"));
    const result = await db.$transaction((tx) => writeOstroMenu(tx, hotel.id, menu));
    console.log(`Imported into ${hotel.slug}: ${result.categories} categories, ${result.items} items.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
