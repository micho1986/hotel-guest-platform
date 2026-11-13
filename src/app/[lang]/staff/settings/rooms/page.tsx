import { ActionForm } from "@/components/action-form";
import { card, input, label, td, th } from "@/components/ui";
import { listRooms } from "@/server/admin/rooms";
import { requireStaff } from "@/server/auth/session-cookie";
import { addRoomsAction, setRoomActiveAction } from "../../actions";

export const metadata = { title: "Rooms" };

export default async function RoomsPage() {
  const actor = await requireStaff({ permission: "settings.view" });
  const rooms = await listRooms(actor);
  return (
    <div className="grid gap-6">
      <section className={card}>
        <h2 className="mb-1 font-medium text-navy">Add rooms</h2>
        <p className="mb-4 text-sm text-charcoal/70">
          One per line: <code className="font-mono">101</code>, or <code className="font-mono">101, 1</code> (room, floor), or a range{" "}
          <code className="font-mono">101-110, 1, Tower A</code>. If any room already exists, nothing is added.
        </p>
        <ActionForm action={addRoomsAction} submitLabel="Add rooms">
          <label className={label} htmlFor="lines">Rooms</label>
          <textarea className={`${input} mb-4 h-28 font-mono`} id="lines" name="lines" required placeholder={"101-110, 1\n201-210, 2"} />
        </ActionForm>
      </section>
      <section className={card}>
        <h2 className="mb-4 font-medium text-navy">Rooms ({rooms.length})</h2>
        {rooms.length === 0 ? (
          <p className="text-sm text-charcoal/70">No rooms yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr><th className={th}>Room</th><th className={th}>Floor</th><th className={th}>Building</th><th className={th}>Status</th><th className={th} /></tr>
              </thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.id} className="border-t border-soft-gray">
                    <td className={`${td} font-mono font-semibold`}>{r.number}</td>
                    <td className={td}>{r.floor ?? "—"}</td>
                    <td className={td}>{r.building ?? "—"}</td>
                    <td className={td}>{r.isActive ? "Active" : "Inactive"}</td>
                    <td className={td}>
                      <ActionForm action={setRoomActiveAction} submitLabel={r.isActive ? "Deactivate" : "Activate"} quiet>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="active" value={String(!r.isActive)} />
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
