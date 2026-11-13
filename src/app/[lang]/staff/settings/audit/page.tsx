import { card, td, th } from "@/components/ui";
import { listAuditLog } from "@/server/admin/audit-log";
import { getHotel } from "@/server/admin/hotel";
import { requireStaff } from "@/server/auth/session-cookie";

export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  const actor = await requireStaff({ permission: "audit.view" });
  const [entries, hotel] = await Promise.all([listAuditLog(actor), getHotel(actor)]);
  const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: hotel.timezone });
  return (
    <section className={card}>
      <h2 className="mb-1 font-medium text-navy">Audit log</h2>
      <p className="mb-4 text-sm text-charcoal/70">The latest {entries.length} entries, newest first. Times in {hotel.timezone}. Entries can&apos;t be edited or deleted.</p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr><th className={th}>When</th><th className={th}>Who</th><th className={th}>Action</th><th className={th}>Details</th></tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-soft-gray">
                <td className={`${td} whitespace-nowrap`}>{when.format(e.createdAt)}</td>
                <td className={td}>{e.actorName}</td>
                <td className={`${td} font-mono text-xs`}>{e.action}</td>
                <td className={`${td} max-w-xs truncate font-mono text-xs text-charcoal/70`}>{e.diff ? JSON.stringify(e.diff) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
