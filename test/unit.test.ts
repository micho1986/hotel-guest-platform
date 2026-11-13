import { describe, expect, it } from "vitest";
import { scopeArgs } from "@/server/db";
import { generateAccessToken, hashAccessToken } from "@/server/tokens";
import { dirFor, getDictionary, isLocale, preferredLocale } from "@/i18n";

const H = "11111111-1111-1111-1111-111111111111";

describe("tenant scoping (layer 1)", () => {
  it("adds hotelId to filters and overrides a caller-supplied one", () => {
    expect(scopeArgs("Request", "findMany", { where: { hotelId: "other", status: "SUBMITTED" } }, H)).toEqual({
      where: { hotelId: H, status: "SUBMITTED" },
    });
    expect(scopeArgs("Request", "findMany", {}, H)).toEqual({ where: { hotelId: H } });
  });

  it("scopes the hotels table by id", () => {
    expect(scopeArgs("Hotel", "findFirst", {}, H)).toEqual({ where: { id: H } });
  });

  it("stamps hotelId on created rows", () => {
    expect(scopeArgs("Room", "create", { data: { number: "101" } }, H)).toEqual({ data: { number: "101", hotelId: H } });
    expect(scopeArgs("Room", "createMany", { data: [{ number: "101" }, { number: "102" }] }, H)).toEqual({
      data: [{ number: "101", hotelId: H }, { number: "102", hotelId: H }],
    });
    const upsert = scopeArgs("Room", "upsert", { where: { id: "x" }, create: { number: "1" } }, H);
    expect(upsert.where).toEqual({ id: "x", hotelId: H });
    expect(upsert.create).toEqual({ number: "1", hotelId: H });
  });
});

describe("guest tokens", () => {
  it("are 32 random bytes, URL-safe, and only their SHA-256 hash is stored", () => {
    const token = generateAccessToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generateAccessToken()).not.toBe(token);
    expect(hashAccessToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAccessToken(token)).not.toContain(token);
  });
});

describe("i18n", () => {
  it("lays Arabic out right-to-left and English left-to-right", () => {
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("en")).toBe("ltr");
  });

  it("has the same keys in both languages", () => {
    expect(Object.keys(getDictionary("ar")).sort()).toEqual(Object.keys(getDictionary("en")).sort());
  });

  it("accepts only supported locales", () => {
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("fr")).toBe(false);
  });

  it("picks Arabic from the browser language, otherwise English", () => {
    expect(preferredLocale("ar-AE,ar;q=0.9,en;q=0.8")).toBe("ar");
    expect(preferredLocale("en-GB,en;q=0.9,ar;q=0.8")).toBe("en");
    expect(preferredLocale(null)).toBe("en");
  });
});
