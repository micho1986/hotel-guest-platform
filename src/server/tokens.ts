import { createHash, randomBytes } from "node:crypto";

/** A new guest access token: 32 random bytes, URL-safe. Shown once (in the QR), never stored. */
export function generateAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What the database stores and looks up: the token's SHA-256 hash. */
export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
