import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Migrations and seeding run as the admin role (owns tables, bypasses RLS).
// The running app uses DATABASE_URL (hotel_app role, RLS enforced) — see src/server/db.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_ADMIN_URL"),
    // Only needed by `prisma migrate dev` / `pnpm db:check-drift`.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
