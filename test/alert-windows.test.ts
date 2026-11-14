import { describe, expect, it } from "vitest";
import { alertWindowMs, isAlertDue } from "@/server/requests/alerts";

const MIN = 60_000;
const base = new Date("2026-11-14T10:00:00Z");

describe("alert windows (M4)", () => {
  it("is 5 minutes for urgent and 10 minutes for normal", () => {
    expect(alertWindowMs("URGENT")).toBe(5 * MIN);
    expect(alertWindowMs("NORMAL")).toBe(10 * MIN);
  });

  it("is not due just before the normal window and is due at it", () => {
    const req = { priority: "NORMAL" as const, status: "RECEIVED" as const, createdAt: base, alertedAt: null };
    expect(isAlertDue(req, new Date(base.getTime() + 10 * MIN - 1000))).toBe(false);
    expect(isAlertDue(req, new Date(base.getTime() + 10 * MIN))).toBe(true);
  });

  it("is due for an urgent request at 5 minutes", () => {
    const req = { priority: "URGENT" as const, status: "RECEIVED" as const, createdAt: base, alertedAt: null };
    expect(isAlertDue(req, new Date(base.getTime() + 5 * MIN))).toBe(true);
  });

  it("counts from the last alert, not from creation, once alerted", () => {
    const req = { priority: "URGENT" as const, status: "RECEIVED" as const, createdAt: base, alertedAt: new Date(base.getTime() + 5 * MIN) };
    expect(isAlertDue(req, new Date(base.getTime() + 9 * MIN))).toBe(false);
    expect(isAlertDue(req, new Date(base.getTime() + 10 * MIN))).toBe(true);
  });

  it("is never due once a request has left RECEIVED", () => {
    const req = { priority: "URGENT" as const, status: "ACCEPTED" as const, createdAt: base, alertedAt: null };
    expect(isAlertDue(req, new Date(base.getTime() + 60 * MIN))).toBe(false);
  });
});
