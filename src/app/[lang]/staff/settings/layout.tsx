import Link from "next/link";
import { can } from "@/server/auth/permissions";
import { requireStaff, STAFF_BASE } from "@/server/auth/session-cookie";

const NAV = [
  ["", "Hotel profile"],
  ["/departments", "Departments"],
  ["/rooms", "Rooms"],
  ["/staff", "Staff & roles"],
  ["/services", "Services"],
  ["/audit", "Audit log"],
] as const;

export default async function SettingsLayout({ children }: LayoutProps<"/[lang]/staff/settings">) {
  const actor = await requireStaff({ permission: "settings.view" });
  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-2xl text-navy">Hotel settings</h1>
        <Link href={STAFF_BASE} className="text-sm text-navy underline">Back to staff home</Link>
      </div>
      <nav className="mb-6 flex flex-wrap gap-2 border-b border-soft-gray pb-3">
        {NAV.map(([path, name]) => (
          <Link key={path} href={`${STAFF_BASE}/settings${path}`} className="rounded-full px-3 py-1 text-sm text-navy hover:bg-white">
            {name}
          </Link>
        ))}
      </nav>
      {!can(actor, "settings.manage") && (
        <p className="mb-4 rounded-lg bg-white px-3 py-2 text-sm text-charcoal/70">You can view these settings. Only a hotel admin can change them.</p>
      )}
      {children}
    </div>
  );
}
