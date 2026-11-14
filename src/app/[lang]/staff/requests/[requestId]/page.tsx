import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { card, input, label } from "@/components/ui";
import { can } from "@/server/auth/permissions";
import { requireStaff, STAFF_BASE } from "@/server/auth/session-cookie";
import { formatHotelTime, STATUS_LABEL } from "@/server/requests/labels";
import { getRequestForStaff } from "@/server/requests/staff";
import { acceptAction, completeAction, noteAction, photoAction, rejectAction, resumeAction, startAction, waitAction } from "./actions";

export const metadata = { title: "Request" };

const ACTOR_LABEL = { GUEST: "Guest", STAFF: "Staff", SYSTEM: "System" } as const;

export default async function RequestDetail({ params }: PageProps<"/[lang]/staff/requests/[requestId]">) {
  const actor = await requireStaff({ permission: "requests.view" });
  const { requestId } = await params;
  const r = await getRequestForStaff(actor, requestId);
  if (!r) notFound();

  const canManage = can(actor, "requests.manage");
  const mine = r.assigneeId === actor.staffId;
  const hiddenId = <input type="hidden" name="requestId" value={r.id} />;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <AutoRefresh />
      <Link href={`${STAFF_BASE}/requests`} className="text-sm text-navy underline">Back to queue</Link>
      <header className="mt-2 mb-6">
        <h1 className="font-display text-3xl text-navy">{r.publicRef}</h1>
        <p className="mt-1 text-sm text-charcoal/70">
          Room {r.room.number} · {r.serviceItem.nameEn} × {r.qty} · {r.priority === "URGENT" ? "Urgent" : "Normal"} · {STATUS_LABEL[r.status]}
        </p>
        {r.guestNote && (
          <p className="mt-3 rounded-lg bg-ivory px-3 py-2 text-sm">
            <span className="block text-xs text-charcoal/60 uppercase">Guest note</span>
            {r.guestNote}
          </p>
        )}
      </header>

      {canManage && (
        <section className={`${card} mb-4`} aria-labelledby="actions">
          <h2 id="actions" className="mb-4 font-medium text-navy">Actions</h2>
          <div className="grid gap-6">
            {r.status === "RECEIVED" && (
              <>
                <ActionForm action={acceptAction} submitLabel="Accept request">{hiddenId}</ActionForm>
                <ActionForm action={rejectAction} submitLabel="Reject and return to queue" quiet>
                  {hiddenId}
                  <label className={label} htmlFor="reject-reason">Reason (kept for the team)</label>
                  <textarea id="reject-reason" name="reason" required maxLength={500} rows={2} className={`${input} mb-3`} />
                </ActionForm>
              </>
            )}
            {r.status === "ACCEPTED" && mine && <ActionForm action={startAction} submitLabel="Start">{hiddenId}</ActionForm>}
            {r.status === "IN_PROGRESS" && mine && (
              <>
                <ActionForm action={completeAction} submitLabel="Mark completed">{hiddenId}</ActionForm>
                <ActionForm action={waitAction} submitLabel="Waiting for guest" quiet>
                  {hiddenId}
                  <label className={label} htmlFor="wait-reason">Why (for example, guest not in room)</label>
                  <input id="wait-reason" name="reason" required maxLength={300} className={`${input} mb-3`} />
                </ActionForm>
              </>
            )}
            {r.status === "WAITING_FOR_GUEST" && mine && <ActionForm action={resumeAction} submitLabel="Resume">{hiddenId}</ActionForm>}
            <ActionForm action={noteAction} submitLabel="Add internal note" quiet>
              {hiddenId}
              <label className={label} htmlFor="note">Internal note (guests cannot see this)</label>
              <textarea id="note" name="note" required maxLength={1000} rows={2} className={`${input} mb-3`} />
            </ActionForm>
          </div>
        </section>
      )}

      <section className={`${card} mb-4`} aria-labelledby="photo">
        <h2 id="photo" className="mb-4 font-medium text-navy">Photo</h2>
        {r.photos.length > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by the authenticated route, never cached publicly
          <img src={`${STAFF_BASE}/requests/${r.id}/photo`} alt={`Photo for request ${r.publicRef}`} className="max-h-80 rounded-lg" />
        ) : canManage ? (
          <ActionForm action={photoAction} submitLabel="Upload photo" className="grid gap-3">
            {hiddenId}
            <input type="file" name="photo" required accept="image/jpeg,image/png,image/webp" className="text-sm" />
            <p className="text-xs text-charcoal/60">JPEG, PNG or WebP, up to 5 MB. One photo per request.</p>
          </ActionForm>
        ) : (
          <p className="text-sm text-charcoal/70">No photo.</p>
        )}
      </section>

      <section className={card} aria-labelledby="timeline">
        <h2 id="timeline" className="mb-4 font-medium text-navy">Timeline</h2>
        <ol className="grid gap-3">
          {r.events.map((e, i) => (
            <li key={i} className="border-l-2 border-champagne pl-3 text-sm">
              <span className="block text-xs text-charcoal/60">
                {formatHotelTime(e.createdAt)} · {ACTOR_LABEL[e.actorType]}
              </span>
              <span>
                {e.fromStatus ? `${STATUS_LABEL[e.fromStatus]} → ` : ""}
                {STATUS_LABEL[e.toStatus]}
              </span>
              {e.note && <span className="block text-charcoal/80">{e.isInternal ? "Internal: " : ""}{e.note}</span>}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
