import Link from "next/link";
import { buttonQuiet, card } from "@/components/ui";
import { can } from "@/server/auth/permissions";
import { requireStaff, STAFF_BASE } from "@/server/auth/session-cookie";
import { logoutAction } from "./actions";

export const metadata = { title: "Staff home" };

const ROLE_LABEL = { EMPLOYEE: "Employee", SUPERVISOR: "Supervisor", GM: "General Manager", HOTEL_ADMIN: "Hotel Admin", FRONT_DESK: "Front desk" };

export default async function StaffHome({ searchParams }: PageProps<"/[lang]/staff">) {
  const actor = await requireStaff();
  const { denied } = await searchParams;
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-12">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-navy">Welcome, {actor.name}</h1>
          <p className="mt-1 text-sm text-charcoal/70">
            {actor.memberships.map((m) => ROLE_LABEL[m.role]).join(", ")} · {actor.email}
          </p>
        </div>
        <form action={logoutAction}>
          <button className={buttonQuiet}>Sign out</button>
        </form>
      </div>
      {denied && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Your role doesn&apos;t have access to that page.</p>}
      <div className={`${card} mb-4`}>
        <p className="font-medium text-navy">Request queue</p>
        <p className="mt-1 text-sm text-charcoal/70">Guest requests arrive here from milestone M3.</p>
      </div>
      {can(actor, "settings.view") && (
        <Link href={`${STAFF_BASE}/settings`} className={`${card} mb-4 block hover:border-champagne-dark`}>
          <p className="font-medium text-navy">Hotel settings</p>
          <p className="mt-1 text-sm text-charcoal/70">Profile, departments, rooms, staff, services and the audit log.</p>
        </Link>
      )}
      <Link href={`${STAFF_BASE}/password`} className="text-sm text-navy underline">Change my password</Link>
    </main>
  );
}
