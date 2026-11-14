import { requireStaff } from "@/server/auth/session-cookie";
import { isUuid } from "@/server/ids";
import { readRequestPhoto } from "@/server/requests/photos";

/** A request's photo for staff in its department. Never cached by a shared cache. */
export async function GET(_req: Request, { params }: { params: Promise<{ lang: string; requestId: string }> }) {
  const actor = await requireStaff({ permission: "requests.view" });
  const { requestId } = await params;
  const photo = isUuid(requestId) ? await readRequestPhoto(actor, requestId) : null;
  if (!photo) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  return new Response(new Uint8Array(photo.bytes), {
    headers: { "Content-Type": photo.contentType, "Cache-Control": "private, no-store" },
  });
}
