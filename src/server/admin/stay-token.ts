import "server-only";
import { generateAccessToken, hashAccessToken } from "@/server/tokens";

/** A new guest token: the plain value goes on the QR card once, only its hash is stored. */
export function newStayToken(): { token: string; hash: string } {
  const token = generateAccessToken();
  return { token, hash: hashAccessToken(token) };
}
