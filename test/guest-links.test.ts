import { afterEach, describe, expect, it } from "vitest";
import { guestLinks } from "@/server/guest-links";

const original = process.env.APP_ORIGIN;
afterEach(() => {
  process.env.APP_ORIGIN = original;
});

describe("guest links on a QR card", () => {
  it("builds English and Arabic links from APP_ORIGIN", () => {
    process.env.APP_ORIGIN = "https://pilot.example";
    expect(guestLinks("abc")).toEqual({ en: "https://pilot.example/en/g/abc", ar: "https://pilot.example/ar/g/abc" });
  });

  it("drops a trailing slash from APP_ORIGIN", () => {
    process.env.APP_ORIGIN = "https://pilot.example/";
    expect(guestLinks("abc").en).toBe("https://pilot.example/en/g/abc");
  });

  it("refuses to build production links without APP_ORIGIN", () => {
    delete process.env.APP_ORIGIN;
    const env = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      expect(() => guestLinks("abc")).toThrow("APP_ORIGIN is not set");
    } finally {
      (process.env as Record<string, string>).NODE_ENV = env!;
    }
  });
});
