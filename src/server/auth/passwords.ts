import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

export const MIN_PASSWORD_LENGTH = 10;

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Verifying against this when the account doesn't exist keeps response times
// the same, so timing can't reveal which emails are registered.
let dummyHash: Promise<string> | undefined;
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hash("dummy-password-for-timing");
  await verifyPassword(await dummyHash, password);
  return false;
}

/** Returns an error message, or null if the password is acceptable. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 200) return "Use at most 200 characters.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return "Use both letters and numbers.";
  return null;
}

/** A temporary password an admin can read out or hand over: 12 chars, no look-alikes. */
export function generateTemporaryPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  for (;;) {
    let out = "";
    for (const b of randomBytes(12)) out += chars[b % chars.length];
    if (passwordProblem(out) === null) return out; // needs letters and digits
  }
}
