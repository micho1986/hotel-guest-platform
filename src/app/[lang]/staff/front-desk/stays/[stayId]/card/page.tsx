import Link from "next/link";
import QRCode from "qrcode";
import { card } from "@/components/ui";
import { guestLinks } from "@/server/guest-links";
import { verifyCardToken } from "@/server/admin/stays";
import { requireStaff, STAFF_BASE } from "@/server/auth/session-cookie";
import { readCardToken } from "@/server/front-desk-card";
import { PrintButton } from "./print-button";

export const metadata = { title: "Guest card" };
export const instant = false;

type Params = { params: Promise<{ stayId: string }> };

/** Printable QR cards for a just-issued link. Shown only while the cookie holds the current token. */
export default async function CardPage({ params }: Params) {
  const { stayId } = await params;
  const actor = await requireStaff({ permission: "stays.manage" });
  const token = await readCardToken(stayId);
  if (!token || !(await verifyCardToken(actor, stayId, token))) {
    return (
      <section className={`${card} max-w-xl`}>
        <h2 className="mb-2 font-medium text-navy">Card no longer available</h2>
        <p className="mb-4 text-sm text-charcoal/70">
          The card is shown once after check-in or reissue. To give the guest a new link, reissue it from the stay list.
        </p>
        <Link href={`${STAFF_BASE}/front-desk/stays`} className="text-sm text-navy underline">Back to stays</Link>
      </section>
    );
  }
  const links = guestLinks(token);
  const [en, ar] = await Promise.all([
    QRCode.toString(links.en, { type: "svg", margin: 1, width: 220 }),
    QRCode.toString(links.ar, { type: "svg", margin: 1, width: 220 }),
  ]);

  return (
    <div className="grid gap-6 print:block">
      <div className="flex items-center justify-between print:hidden">
        <h2 className="font-medium text-navy">Guest cards</h2>
        <div className="flex gap-4">
          <PrintButton label="Print" />
          <Link href={`${STAFF_BASE}/front-desk/stays`} className="text-sm text-navy underline">Back to stays</Link>
        </div>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 print:grid-cols-2">
        <Card title="English" svg={en} url={links.en} />
        <Card title="العربية" svg={ar} url={links.ar} />
      </div>
    </div>
  );
}

function Card({ title, svg, url }: { title: string; svg: string; url: string }) {
  return (
    <section className={`${card} text-center print:break-inside-avoid`}>
      <h3 className="mb-3 font-medium text-navy">{title}</h3>
      <div className="mx-auto w-[220px]" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="mt-3 break-all font-mono text-xs text-charcoal/60">{url}</p>
    </section>
  );
}
