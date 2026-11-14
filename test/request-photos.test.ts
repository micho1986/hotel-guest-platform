import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { photoStore } from "@/server/photos/store";
import { detectImageType, readRequestPhoto, uploadRequestPhoto } from "@/server/requests/photos";
import { adminDb, createHotelWithData, createStaffUser } from "./fixtures";

let hotelId: string;
let hkRequestId: string;
let engRequestId: string;
let hkEmployee: Actor;
let engEmployee: Actor;

function actorFrom(user: { id: string; name: string; email: string }, departmentId: string): Actor {
  return {
    staffId: user.id,
    hotelId,
    sessionId: "test-session",
    name: user.name,
    email: user.email,
    memberships: [{ role: "EMPLOYEE", departmentId }],
    mfaEnrolled: false,
    mfaVerified: false,
    mustChangePassword: false,
  };
}

async function jpegWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 50, b: 50 } } })
    .withExif({ IFD0: { Copyright: "private location data" } })
    .jpeg()
    .toBuffer();
}

beforeAll(async () => {
  const h = await createHotelWithData("photos");
  hotelId = h.hotelId;
  const eng = await adminDb.department.create({ data: { hotelId, code: "ENG", nameEn: "Engineering", nameAr: "الهندسة" } });
  hkEmployee = actorFrom(await createStaffUser(hotelId, { email: "hk@photos.test", role: "EMPLOYEE", departmentId: h.dept.id }), h.dept.id);
  engEmployee = actorFrom(await createStaffUser(hotelId, { email: "eng@photos.test", role: "EMPLOYEE", departmentId: eng.id }), eng.id);
  hkRequestId = (await h.createRequest(null)).id;
  engRequestId = (
    await adminDb.request.create({
      data: { hotelId, publicRef: "ENG-9001", roomId: h.room.id, serviceItemId: h.item.id, departmentId: eng.id, qty: 1 },
    })
  ).id;
});

afterAll(async () => {
  await adminDb.$disconnect();
});

describe("detectImageType", () => {
  it("recognises JPEG, PNG and WebP by their first bytes, and nothing else", () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe("png");
    expect(detectImageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))).toBe("webp");
    expect(detectImageType(Buffer.from("<script>alert(1)</script>"))).toBeNull();
  });
});

describe("uploadRequestPhoto", () => {
  it("refuses a file that is not an image, even when it is named .png, and stores nothing (Review Focus 2)", async () => {
    const result = await uploadRequestPhoto(hkEmployee, hkRequestId, Buffer.from("<script>alert(1)</script>"));
    expect(result.ok).toBe(false);
    expect(await adminDb.requestPhoto.count({ where: { requestId: hkRequestId } })).toBe(0);
  });

  it("refuses a file one byte over 5 MB", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff], 0);
    const result = await uploadRequestPhoto(hkEmployee, hkRequestId, big);
    expect(result.ok).toBe(false);
  });

  it("accepts a real JPEG, re-encodes it without EXIF, and stores it under the request", async () => {
    const result = await uploadRequestPhoto(hkEmployee, hkRequestId, await jpegWithExif());
    expect(result.ok).toBe(true);
    const row = await adminDb.requestPhoto.findFirstOrThrow({ where: { requestId: hkRequestId } });
    const stored = await photoStore.get(row.storageKey);
    expect(stored).not.toBeNull();
    const meta = await sharp(stored!).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it("refuses a second photo for the same request", async () => {
    const result = await uploadRequestPhoto(hkEmployee, hkRequestId, await jpegWithExif());
    expect(result.ok).toBe(false);
    expect(await adminDb.requestPhoto.count({ where: { requestId: hkRequestId } })).toBe(1);
  });

  it("refuses an upload for a request in another department", async () => {
    const result = await uploadRequestPhoto(hkEmployee, engRequestId, await jpegWithExif());
    expect(result.ok).toBe(false);
  });
});

describe("readRequestPhoto", () => {
  it("returns the photo to someone in the request's department", async () => {
    const photo = await readRequestPhoto(hkEmployee, hkRequestId);
    expect(photo).not.toBeNull();
    expect(photo!.contentType).toBe("image/jpeg");
    expect(detectImageType(photo!.bytes)).toBe("jpeg");
  });

  it("refuses an engineering employee reading a housekeeping request's photo", async () => {
    expect(await readRequestPhoto(engEmployee, hkRequestId)).toBeNull();
  });
});
