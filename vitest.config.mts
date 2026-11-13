import "dotenv/config";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": src,
      // Next.js guard that throws outside the server bundle; harmless in tests.
      "server-only": fileURLToPath(new URL("./test/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    // Tests run against the test database, never the dev one.
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      DATABASE_ADMIN_URL: process.env.TEST_DATABASE_ADMIN_URL ?? "",
    },
  },
});
