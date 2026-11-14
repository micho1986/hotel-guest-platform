import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { card, td, th } from "@/components/ui";
import { listStays } from "@/server/admin/stays";
import { can } from "@/server/auth/permissions";
import { requireStaff, STAFF_BASE } from "@/server/auth/session-cookie";
import { checkOutAction, reissueTokenAction } from "../../actions";

export const metadata = { title: "Stays" };

export default async function StaysPage() {
  const actor = await requireStaff({ permission: "stays.view" });
  const stays = await listStays(actor);
  const canManage = can(actor, "stays.manage");
  const day = (d: Date) => d.toISOString().slice(0, 10);

  return (
    <section className={card}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-medium text-navy">Stays ({stays.length})</h2>
        <Link href={`${STAFF_BASE}/front-desk`} className="text-sm text-navy underline">Check in a guest</Link>
      </div>
      {stays.length === 0 ? (
        <p className="text-sm text-charcoal/70">No stays yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>Room</th><th className={th}>Guest</th><th className={th}>Dates</th><th className={th}>Status</th><th className={th} />
              </tr>
            </thead>
            <tbody>
              {stays.map((s) => (
                <tr key={s.id} className="border-t border-soft-gray">
                  <td className={`${td} font-mono font-semibold`}>{s.room.number}</td>
                  <td className={td}>{s.guestDisplayName}</td>
                  <td className={td}>{day(s.checkIn)} → {day(s.checkOut)}</td>
                  <td className={td}>{s.status === "ACTIVE" ? "In house" : "Checked out"}</td>
                  <td className={td}>
                    {s.status === "ACTIVE" && canManage && (
                      <span className="flex flex-wrap gap-2">
                        <ActionForm action={reissueTokenAction} submitLabel="Reissue card" quiet>
                          <input type="hidden" name="stayId" value={s.id} />
                        </ActionForm>
                        <ActionForm action={checkOutAction} submitLabel="Check out" quiet>
                          <input type="hidden" name="stayId" value={s.id} />
                        </ActionForm>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
