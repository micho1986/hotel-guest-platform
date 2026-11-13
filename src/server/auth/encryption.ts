import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for small secrets at rest (staff TOTP secrets).
 * Key: APP_ENCRYPTION_KEY, 32 random bytes, base64. Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * Stored format: v1.<iv>.<tag>.<ciphertext>, each part base64url.
 */
function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  const buf = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (buf.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return buf;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
