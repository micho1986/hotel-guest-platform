import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalPhotoStore, safeKey } from "@/server/photos/store";

describe("local photo store", () => {
  const store = createLocalPhotoStore(mkdtempSync(join(tmpdir(), "photos-")));

  it("round-trips bytes", async () => {
    await store.put("k1.jpg", Buffer.from("hello"));
    expect((await store.get("k1.jpg"))!.toString()).toBe("hello");
  });

  it("returns null for a missing key", async () => {
    expect(await store.get("missing.jpg")).toBeNull();
  });

  it("refuses keys that could leave the upload folder", () => {
    expect(() => safeKey("../etc/passwd")).toThrow();
    expect(() => safeKey("a/b.jpg")).toThrow();
    expect(() => safeKey("a\\b.jpg")).toThrow();
    expect(() => safeKey("")).toThrow();
    expect(safeKey("req-1.jpg")).toBe("req-1.jpg");
  });
});
