import Link from "next/link";
import { AlertSound } from "@/components/alert-sound";
import { AutoRefresh } from "@/components/auto-refresh";
import { card, td, th } from "@/components/ui";
import { requireStaff, STAFF_BASE } from "@/server/auth/session-cookie";
import { formatHotelTime, STATUS_LABEL } from "@/server/requests/labels";
import { countUnreadAlerts } from "@/server/requests/notifications";
import { listQueue, type QueueTab } from "@/server/requests/staff";
import { savePushSubscriptionAction } from "../actions";

export const metadata = { title: "Requests" };

const TABS: { key: QueueTab; label: string }[] = [
  { key: "new", label: "New" },
  { key: "mine", label: "Mine" },
  { key: "in_progress", label: "In progress" },
  { key: "done_today", label: "Done today" },
];

export default async function RequestQueue({ searchParams }: PageProps<"/[lang]/staff/requests">) {
  const actor = await requireStaff({ permission: "requests.view" });
  const { tab, transferred } = await searchParams;
  const active: QueueTab = TABS.find((t) => t.key === tab)?.key ?? "new";
  const [rows, alertCount] = await Promise.all([listQueue(actor, active), countUnreadAlerts(actor)]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <AutoRefresh />
      <Link href={STAFF_BASE} className="text-sm text-navy underline">Staff home</Link>
      <h1 className="mt-2 mb-4 font-display text-3xl text-navy">Requests</h1>
      {transferred && (
        <p role="status" className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          Request transferred. It is now New in the other department&apos;s queue.
        </p>
      )}
      <AlertSound
        alertCount={alertCount}
        vapidPublicKey={process.env.VAPID_PUBLIC_KEY || null}
        saveSubscription={savePushSubscriptionAction}
      />
      <nav aria-label="Queue" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`${STAFF_BASE}/requests?tab=${t.key}`}
            aria-current={t.key === active ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${t.key === active ? "border-navy bg-navy text-ivory" : "border-soft-gray bg-white text-navy hover:border-champagne-dark"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <section className={`${card} overflow-x-auto p-0`}>
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-charcoal/70">Nothing here right now.</p>
        ) : (
          <table className="w-full">
            <thead className="border-b border-soft-gray">
              <tr>
                <th className={th}>Ref</th>
                <th className={th}>Room</th>
                <th className={th}>Item</th>
                <th className={th}>Qty</th>
                <th className={th}>Priority</th>
                <th className={th}>Status</th>
                <th className={th}>Received</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-soft-gray last:border-0 hover:bg-ivory">
                  <td className={td}>
                    <Link href={`${STAFF_BASE}/requests/${r.id}`} className="font-medium text-navy underline">{r.publicRef}</Link>
                  </td>
                  <td className={td}>{r.room.number}</td>
                  <td className={td}>{r.serviceItem.nameEn}</td>
                  <td className={td}>{r.qty}</td>
                  <td className={td}>{r.priority === "URGENT" ? <span className="font-semibold text-red-700">Urgent</span> : "Normal"}</td>
                  <td className={td}>{STATUS_LABEL[r.status]}</td>
                  <td className={td}>{formatHotelTime(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
