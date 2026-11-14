import Link from "next/link";
import { AlertSound } from "@/components/alert-sound";
import { AutoRefresh } from "@/components/auto-refresh";
import { buttonQuiet, card } from "@/components/ui";
import { can } from "@/server/auth/permissions";
import { requireStaff, STAFF_BASE } from "@/server/auth/session-cookie";
import { countUnreadAlerts } from "@/server/requests/notifications";
import { logoutAction, savePushSubscriptionAction } from "./actions";

export const metadata = { title: "Staff home" };

const ROLE_LABEL = { EMPLOYEE: "Employee", SUPERVISOR: "Supervisor", GM: "General Manager", HOTEL_ADMIN: "Hotel Admin", FRONT_DESK: "Front desk" };

export default async function StaffHome({ searchParams }: PageProps<"/[lang]/staff">) {
  const actor = await requireStaff();
  const { denied } = await searchParams;
  const alertCount = await countUnreadAlerts(actor);
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
      <AutoRefresh />
      {/* Hotel admins get alerts for departments with no supervisor; this is where they see them. */}
      <AlertSound
        alertCount={alertCount}
        vapidPublicKey={process.env.VAPID_PUBLIC_KEY || null}
        saveSubscription={savePushSubscriptionAction}
        hint={can(actor, "requests.view") ? "Open Requests to see them." : "They clear when the department picks the request up."}
      />
      {denied && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Your role doesn&apos;t have access to that page.</p>}
      {can(actor, "requests.view") && (
        <Link href={`${STAFF_BASE}/requests`} className={`${card} mb-4 block hover:border-champagne-dark`}>
          <p className="font-medium text-navy">Requests</p>
          <p className="mt-1 text-sm text-charcoal/70">New guest requests, what is in progress, and what finished today.</p>
        </Link>
      )}
      {can(actor, "requests.view") && (
        <Link href={`${STAFF_BASE}/chat`} className={`${card} mb-4 block hover:border-champagne-dark`}>
          <p className="font-medium text-navy">Team chat</p>
          <p className="mt-1 text-sm text-charcoal/70">Talk with your department while you work.</p>
        </Link>
      )}
      {can(actor, "stays.view") && (
        <Link href={`${STAFF_BASE}/front-desk/stays`} className={`${card} mb-4 block hover:border-champagne-dark`}>
          <p className="font-medium text-navy">Front desk</p>
          <p className="mt-1 text-sm text-charcoal/70">Check guests in, reissue guest links and check guests out.</p>
        </Link>
      )}
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
