import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { ActionForm } from "@/components/action-form";
import { card, input, label } from "@/components/ui";
import { requiresMfa } from "@/server/auth/permissions";
import { beginMfaSetup } from "@/server/auth/service";
import { requireStaff, STAFF_BASE } from "@/server/auth/session-cookie";
import { mfaAction } from "../actions";

export const metadata = { title: "2-step verification" };

export default async function MfaPage() {
  const actor = await requireStaff({ stage: "mfa" });
  if (!requiresMfa(actor) || actor.mfaVerified) redirect(STAFF_BASE);

  const setup = actor.mfaEnrolled ? null : await beginMfaSetup(actor);
  const qrSvg = setup ? await QRCode.toString(setup.uri, { type: "svg", margin: 1, width: 200 }) : null;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-12">
      <h1 className="mb-2 font-display text-3xl text-navy">{setup ? "Set up 2-step verification" : "Enter your code"}</h1>
      {setup && qrSvg ? (
        <div className={`${card} mb-4`}>
          <p className="mb-3 text-sm">
            Manager and admin accounts need an authenticator app (Google Authenticator, Microsoft Authenticator or similar).
            Scan this code with the app, then enter the 6-digit code it shows.
          </p>
          <div className="mx-auto w-fit" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <p className="mt-3 text-xs text-charcoal/70">
            Can&apos;t scan? Enter this key in the app:{" "}
            <code data-testid="mfa-secret" className="font-mono break-all select-all">{setup.secret}</code>
          </p>
        </div>
      ) : (
        <p className="mb-6 text-sm text-charcoal/70">Open your authenticator app and enter the current 6-digit code.</p>
      )}
      <ActionForm action={mfaAction} submitLabel={setup ? "Finish setup" : "Verify"} className={card}>
        <div className="mb-5">
          <label className={label} htmlFor="code">6-digit code</label>
          <input className={`${input} text-center font-mono text-lg tracking-[0.4em]`} id="code" name="code" required inputMode="numeric" pattern="[0-9 ]{6,7}" maxLength={7} autoComplete="one-time-code" autoFocus />
        </div>
      </ActionForm>
    </main>
  );
}
