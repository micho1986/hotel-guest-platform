import { describe, expect, it } from "vitest";
import { guestTokenFromParams } from "@/server/guest";

describe("guest token from the URL", () => {
  it("rejects tokens that are too long, empty, or contain characters outside base64url", () => {
    expect(guestTokenFromParams("a".repeat(101))).toBeNull();
    expect(guestTokenFromParams("")).toBeNull();
    expect(guestTokenFromParams("bad token!")).toBeNull();
    expect(guestTokenFromParams("../../etc")).toBeNull();
  });

  it("accepts a well-formed base64url token unchanged", () => {
    const token = "iGXmC8p-tboRr0b3eBNDZZlNKoANqhnX2GUdGUFa9fs";
    expect(guestTokenFromParams(token)).toBe(token);
  });
});
