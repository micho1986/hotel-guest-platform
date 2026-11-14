import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm } from "@/components/action-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { getDictionary, isLocale } from "@/i18n";
import { getGuestRequest, guestTokenFromParams, resolveGuestToken } from "@/server/guest";
import { guestFeedback, guestTimeline } from "@/server/guest-requests";
import { cancelAction, rateAction } from "./actions";

const LIVE = new Set(["COMPLETED", "CANCELLED"]);

export default async function GuestRequestDetail({ params }: PageProps<"/[lang]/g/[token]/requests/[requestId]">) {
  const { lang, token, requestId } = await params;
  if (!isLocale(lang)) notFound();
  const tok = guestTokenFromParams(token);
  const guest = tok ? await resolveGuestToken(tok) : null;
  if (!guest || !z.uuid().safeParse(requestId).success) notFound();
  const t = getDictionary(lang);

  const r = await getGuestRequest(guest, requestId);
  if (!r) notFound();
  const [steps, feedback] = await Promise.all([guestTimeline(guest, requestId), guestFeedback(guest, requestId)]);

  const when = (d: Date) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-AE" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" }).format(d);
  const hidden = (
    <>
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="requestId" value={r.id} />
    </>
  );
  const canCancel = r.status === "SUBMITTED" || r.status === "RECEIVED";

  return (
    <>
      {!LIVE.has(r.status) && <AutoRefresh />}
      <h1 className="font-display text-2xl text-navy rtl:font-arabic">{t.guest.requestTitle}</h1>
      {!LIVE.has(r.status) && <p className="text-xs text-charcoal/60">{t.guest.liveNote}</p>}
      <dl className="grid gap-3 rounded-2xl border border-soft-gray bg-white p-5 shadow-sm">
        <div><dt className="text-xs text-charcoal/60">{t.guest.reference}</dt><dd className="font-mono font-semibold text-navy">{r.publicRef}</dd></div>
        <div><dt className="text-xs text-charcoal/60">{t.guest.status}</dt><dd>{t.guest.statuses[r.status]}</dd></div>
        <div><dt className="text-xs text-charcoal/60">{t.guest.submitted}</dt><dd>{when(r.createdAt)}</dd></div>
        {r.guestNote && <div><dt className="text-xs text-charcoal/60">{t.guest.note}</dt><dd>{r.guestNote}</dd></div>}
      </dl>

      {steps.length > 0 && (
        <section className="rounded-2xl border border-soft-gray bg-white p-5 shadow-sm" aria-labelledby="history">
          <h2 id="history" className="mb-3 font-medium text-navy">{t.guest.timeline}</h2>
          <ol className="grid gap-2">
            {steps.map((s, i) => (
              <li key={i} className="flex justify-between gap-3 text-sm">
                <span>{t.guest.statuses[s.toStatus]}</span>
                <span className="text-charcoal/60">{when(s.createdAt)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {canCancel && (
        <ActionForm action={cancelAction} submitLabel={t.guest.cancel} quiet>
          {hidden}
        </ActionForm>
      )}

      {r.status === "COMPLETED" && (
        <section className="rounded-2xl border border-soft-gray bg-white p-5 shadow-sm">
          {feedback ? (
            <p className="text-sm text-navy">{t.guest.rateOnce}</p>
          ) : (
            <ActionForm action={rateAction} submitLabel={t.guest.rate} className="grid gap-4">
              {hidden}
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium text-navy">{t.guest.rateLabel}</legend>
                <div className="flex gap-3">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <label key={n} className="flex items-center gap-1 text-sm">
                      <input type="radio" name="rating" value={n} required /> {n}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="grid gap-1 text-sm text-navy">
                {t.guest.commentLabel}
                <textarea name="comment" maxLength={500} rows={2} className="rounded-lg border border-soft-gray px-3 py-2" />
              </label>
            </ActionForm>
          )}
        </section>
      )}

      <Link href={`/${lang}/g/${token}/requests`} className="text-sm text-navy underline">{t.guest.back}</Link>
    </>
  );
}
