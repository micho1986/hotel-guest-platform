import { redirect } from "next/navigation";
import { Suspense } from "react";
import { STAFF_BASE } from "@/server/auth/session-cookie";

// Staff screens are English-only for the pilot (strings stay simple to translate later).
export default async function StaffLayout({ children, params }: LayoutProps<"/[lang]/staff">) {
  const { lang } = await params;
  if (lang !== "en") redirect(STAFF_BASE);
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<p className="p-8 text-sm text-charcoal/60">Loading…</p>}>{children}</Suspense>
    </div>
  );
}
