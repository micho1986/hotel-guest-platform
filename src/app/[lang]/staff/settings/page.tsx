import { ActionForm } from "@/components/action-form";
import { card, input, label } from "@/components/ui";
import { getHotel } from "@/server/admin/hotel";
import { requireStaff } from "@/server/auth/session-cookie";
import { updateHotelAction } from "../actions";

export const metadata = { title: "Hotel profile" };

export default async function HotelProfilePage() {
  const actor = await requireStaff({ permission: "settings.view" });
  const hotel = await getHotel(actor);
  const colors = (hotel.brandColors ?? {}) as { primary?: string; accent?: string };
  return (
    <section className={card}>
      <h2 className="mb-1 font-medium text-navy">Hotel profile</h2>
      <p className="mb-5 text-sm text-charcoal/70">
        Hotel code for staff sign-in: <code className="font-mono font-semibold">{hotel.slug}</code>
        {hotel.isDemo && " · Sample data"}
      </p>
      <ActionForm action={updateHotelAction} submitLabel="Save profile">
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="name">Hotel name</label>
            <input className={input} id="name" name="name" defaultValue={hotel.name} required maxLength={120} />
          </div>
          <div>
            <label className={label} htmlFor="timezone">Time zone</label>
            <select className={input} id="timezone" name="timezone" defaultValue={hotel.timezone}>
              {Intl.supportedValuesOf("timeZone").map((tz) => <option key={tz}>{tz}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="logoUrl">Logo URL (https, optional)</label>
            <input className={input} id="logoUrl" name="logoUrl" type="url" defaultValue={hotel.logoUrl ?? ""} placeholder="https://…" />
          </div>
          <div>
            <label className={label} htmlFor="primaryColor">Primary colour</label>
            <input className="h-10 w-20" id="primaryColor" name="primaryColor" type="color" defaultValue={colors.primary ?? "#14213D"} />
          </div>
          <div>
            <label className={label} htmlFor="accentColor">Accent colour</label>
            <input className="h-10 w-20" id="accentColor" name="accentColor" type="color" defaultValue={colors.accent ?? "#C9A96E"} />
          </div>
        </div>
      </ActionForm>
    </section>
  );
}
