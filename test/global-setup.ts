import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

/**
 * Rebuilds the test database from the migration files before the run, so the
 * tests always exercise exactly the SQL that ships (including RLS policies).
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_ADMIN_URL;
  if (!url) throw new Error("TEST_DATABASE_ADMIN_URL is not set (see .env.example)");
  if (!/hotel_test/.test(url)) throw new Error("Refusing to reset a database not named hotel_test");

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const dir = join(process.cwd(), "prisma", "migrations");
    const migrations = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const name of migrations) {
      await client.query(readFileSync(join(dir, name, "migration.sql"), "utf8"));
    }
  } finally {
    await client.end();
  }
}
