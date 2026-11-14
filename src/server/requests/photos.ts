import "server-only";
import sharp from "sharp";
import { can, type Actor } from "@/server/auth/permissions";
import { tenantDb, tenantTransaction } from "@/server/db";
import { fail, ok, type ActionResult } from "@/server/forms";
import { photoStore } from "@/server/photos/store";
import { departmentIds, viewScope } from "@/server/requests/staff";

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export type ImageType = "jpeg" | "png" | "webp";

const EXTENSION: Record<ImageType, string> = { jpeg: "jpg", png: "png", webp: "webp" };
const CONTENT_TYPE: Record<ImageType, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return Buffer.from(bytes.subarray(from, to)).toString("latin1");
}

/** Decides the type from the file's first bytes, never from its name or the type the browser sent. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  return null;
}

/**
 * Adds the one photo a request may have. The file is checked by its bytes, size-limited, and re-encoded
 * (which drops EXIF and other metadata, and applies the camera's rotation) before it is stored.
 */
export async function uploadRequestPhoto(actor: Actor, requestId: string, bytes: Buffer): Promise<ActionResult> {
  if (!can(actor, "requests.manage")) return fail("You don't have permission to do that.");
  if (bytes.byteLength > MAX_PHOTO_BYTES) return fail("Photos must be 5 MB or smaller.");
  const type = detectImageType(bytes);
  if (!type) return fail("Upload a JPEG, PNG or WebP photo.");

  const clean = await sharp(bytes).rotate().toFormat(type).toBuffer();
  const storageKey = `${requestId}.${EXTENSION[type]}`;

  return tenantTransaction(actor.hotelId, async (tx) => {
    const request = await tx.request.findFirst({
      where: { id: requestId, hotelId: actor.hotelId, departmentId: { in: departmentIds(actor) } },
      select: { id: true },
    });
    if (!request) return fail("You can only add photos to requests in your department.");
    const existing = await tx.requestPhoto.count({ where: { hotelId: actor.hotelId, requestId } });
    if (existing > 0) return fail("This request already has a photo.");

    await photoStore.put(storageKey, clean);
    await tx.requestPhoto.create({
      data: { hotelId: actor.hotelId, requestId, storageKey, uploadedBy: actor.staffId },
    });
    return ok("Photo added.");
  });
}

export type RequestPhotoRead = { bytes: Buffer; contentType: string };

/** The request's photo for staff in its department. Anything else, including a missing file, reads as null. */
export async function readRequestPhoto(actor: Actor, requestId: string): Promise<RequestPhotoRead | null> {
  if (!can(actor, "requests.view")) return null;
  const db = tenantDb(actor.hotelId);
  const request = await db.request.findFirst({ where: { id: requestId, ...viewScope(actor) }, select: { id: true } });
  if (!request) return null;
  const photo = await db.requestPhoto.findFirst({ where: { requestId }, select: { storageKey: true } });
  if (!photo) return null;
  const bytes = await photoStore.get(photo.storageKey);
  if (!bytes) return null;
  const type = detectImageType(bytes);
  if (!type) return null;
  return { bytes, contentType: CONTENT_TYPE[type] };
}
