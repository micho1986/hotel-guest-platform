import { timingSafeEqual } from "node:crypto";
import { runAlertJob } from "@/server/requests/alert-job";

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Called every minute by an external scheduler. Refuses anything without the bearer secret. */
export async function GET(req: Request) {
  const secret = process.env.ALERT_JOB_SECRET;
  if (!secret || !sameSecret(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const result = await runAlertJob(new Date());
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
