import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { card, input, label } from "@/components/ui";
import { listAvailableRooms } from "@/server/admin/stays";
import { requireStaff, STAFF_BASE } from "@/server/auth/session-cookie";
import { checkInAction } from "../actions";

export const metadata = { title: "Front desk" };

export default async function FrontDeskPage() {
  const actor = await requireStaff({ permission: "stays.manage" });
  const rooms = await listAvailableRooms(actor);
  return (
    <div className="grid gap-6">
      <section className={card}>
        <h2 className="mb-4 font-medium text-navy">Check a guest in</h2>
        {rooms.length === 0 ? (
          <p className="text-sm text-charcoal/70">Every room has a guest, or no rooms are set up yet.</p>
        ) : (
          <ActionForm action={checkInAction} submitLabel="Check in and print card">
            <label className={label} htmlFor="roomId">Room</label>
            <select id="roomId" name="roomId" required className={`${input} mb-4`}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.number}</option>
              ))}
            </select>
            <label className={label} htmlFor="guestDisplayName">Guest name</label>
            <input id="guestDisplayName" name="guestDisplayName" required maxLength={120} className={`${input} mb-4`} />
            <label className={label} htmlFor="checkIn">Check-in date</label>
            <input id="checkIn" name="checkIn" type="date" required className={`${input} mb-4`} />
            <label className={label} htmlFor="checkOut">Check-out date</label>
            <input id="checkOut" name="checkOut" type="date" required className={`${input} mb-4`} />
          </ActionForm>
        )}
      </section>
      <Link href={`${STAFF_BASE}/front-desk/stays`} className="text-sm text-navy underline">All stays</Link>
    </div>
  );
}
