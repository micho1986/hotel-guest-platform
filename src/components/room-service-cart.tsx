"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { input, label } from "@/components/ui";
import { DEFAULT_LOCALE, getDictionary, isLocale } from "@/i18n";
import type { FormAction } from "@/server/forms";

type MenuItem = { id: string; nameEn: string; descriptionEn: string | null; price: number; imageUrl: string | null };
type Menu = { key: string; nameEn: string; items: MenuItem[] }[];

const MAX_QTY = 20;
const storageKey = (token: string) => `room-service:${token}`;

/** Keeps only whole quantities from 1 to MAX_QTY, so a damaged saved cart cannot reach the form. */
function readSaved(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [id, n] of Object.entries(parsed)) {
      if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_QTY) out[id] = n;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The cart lives in this browser tab only. The total shown here is for the guest's convenience; the server
 * prices the order again from the catalogue.
 */
export function RoomServiceCart({
  token,
  lang,
  menu,
  action,
}: {
  token: string;
  lang: string;
  menu: Menu;
  action: FormAction;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const dict = getDictionary(isLocale(lang) ? lang : DEFAULT_LOCALE).guest;
  useEffect(() => {
    if (!zoom) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);
  useEffect(() => {
    if (zoom === null) openerRef.current?.focus();
  }, [zoom]);

  useEffect(() => {
    try {
      // The saved cart exists only in the browser, so it can be read only after mount. Reading it during render
      // would make the server HTML differ from the client's.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQty(readSaved(sessionStorage.getItem(storageKey(token))));
    } catch {
      // Storage is unavailable (private mode, for example): the cart simply starts empty.
    }
  }, [token]);

  const update = (id: string, n: number) => {
    const next = { ...qty };
    if (n > 0) next[id] = n;
    else delete next[id];
    setQty(next);
    try {
      sessionStorage.setItem(storageKey(token), JSON.stringify(next));
    } catch {
      // Keep the cart in memory for this page view even if it cannot be saved.
    }
  };

  const items = menu.flatMap((c) => c.items);
  const lines = items.filter((i) => (qty[i.id] ?? 0) > 0).map((i) => ({ serviceItemId: i.id, qty: qty[i.id] }));
  const total = items.reduce((sum, i) => sum + i.price * (qty[i.id] ?? 0), 0);

  if (menu.length === 0) {
    return <p className="text-charcoal/80">Room service is not available for this stay right now.</p>;
  }

  // Once the guest submits, the saved cart is cleared so that returning to the menu does not show the old order.
  // The in-memory quantities stay, so a failed submit can be retried on this page.
  return (
    <div onSubmitCapture={() => {
      try {
        sessionStorage.removeItem(storageKey(token));
      } catch {
        // Nothing to clear if storage is unavailable.
      }
    }}>
    <ActionForm action={action} submitLabel="Place order" pendingLabel="Placing order…">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />

      {zoom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={zoom.alt}
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <button
            ref={closeRef}
            type="button"
            onClick={() => setZoom(null)}
            className="absolute right-4 top-4 rounded-full bg-white px-3 py-1 text-navy"
          >
            {dict.closePhoto}
          </button>
          <Image src={zoom.src} alt={zoom.alt} width={900} height={900} className="h-auto max-h-[85vh] w-full max-w-3xl rounded-2xl object-contain" />
        </div>
      )}
      <h2 className="mb-2 font-display text-xl text-navy">In-Room Dining</h2>
      {menu.map((c) => (
        <section key={c.key} className="mb-6">
          <h3 className="mb-2 font-medium text-navy">{c.nameEn}</h3>
          <ul className="grid gap-3">
            {c.items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-4 rounded-2xl border border-soft-gray bg-white p-4">
                {i.imageUrl && (
                  <button
                    type="button"
                    onClick={(e) => {
                      openerRef.current = e.currentTarget;
                      setZoom({ src: i.imageUrl as string, alt: i.nameEn });
                    }}
                    aria-label={`${dict.viewPhoto}: ${i.nameEn}`}
                    className="shrink-0 rounded-xl"
                  >
                    <Image src={i.imageUrl} alt={i.nameEn} width={80} height={80} className="h-20 w-20 rounded-xl object-cover" />
                  </button>
                )}
                <div className="flex-1">
                  <p className="font-medium text-navy">{i.nameEn}</p>
                  {i.descriptionEn && <p className="text-sm text-charcoal/70">{i.descriptionEn}</p>}
                  <p className="text-sm text-navy">AED {i.price.toFixed(2)}</p>
                </div>
                <div>
                  <label className={label} htmlFor={`qty-${i.id}`}>Quantity</label>
                  <select
                    id={`qty-${i.id}`}
                    value={qty[i.id] ?? 0}
                    onChange={(e) => update(i.id, Number(e.target.value))}
                    className={input}
                  >
                    {Array.from({ length: MAX_QTY + 1 }, (_, n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <label className={label} htmlFor="cart-note">{dict.note}</label>
      <textarea
        id="cart-note"
        name="guestNote"
        rows={2}
        maxLength={500}
        placeholder={dict.notePlaceholder}
        className={`${input} mb-4`}
      />

      <p className="mb-4 font-medium text-navy">Total: AED {total.toFixed(2)}</p>
    </ActionForm>
    </div>
  );
}
