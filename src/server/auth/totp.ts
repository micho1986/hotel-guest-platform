import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time codes (RFC 6238, SHA-1, 6 digits, 30 s) — the format
 * Google Authenticator, Microsoft Authenticator and 1Password all read.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes, base32 (what the authenticator app stores). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The code for a given time step. `digits` and step size per RFC 6238 defaults. */
export function totpAt(secret: string, unixSeconds: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(unixSeconds / 30)));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** True if `code` matches now, or one step either side (allows for clock drift). */
export function verifyTotp(secret: string, code: string, nowMs = Date.now()): boolean {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const now = Math.floor(nowMs / 1000);
  return [-30, 0, 30].some((drift) => timingSafeEqual(Buffer.from(totpAt(secret, now + drift)), Buffer.from(clean)));
}

/** The link an authenticator app reads from the enrolment QR code. */
export function otpauthUri(issuer: string, account: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
