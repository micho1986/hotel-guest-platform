import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isUuid } from "@/server/ids";

describe("isUuid", () => {
  it("accepts a UUID and refuses anything else before it reaches the database", () => {
    expect(isUuid(randomUUID())).toBe(true);
    expect(isUuid("")).toBe(false);
    expect(isUuid("../../etc/passwd")).toBe(false);
    expect(isUuid("1234")).toBe(false);
    expect(isUuid(randomUUID() + " ")).toBe(false);
  });
});
