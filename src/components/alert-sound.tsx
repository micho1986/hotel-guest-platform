"use client";

import { useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/server/forms";
import { buttonPrimary, buttonQuiet } from "./ui";

/** Remembers on this device that the push question was answered, so it is asked once. */
const ASKED_KEY = "staff-push-asked";
const BEEP_HZ = 880;
const BEEP_SECONDS = 0.35;

type Props = {
  /** Unread request alerts for the signed-in staff member; the page re-renders it every few seconds. */
  alertCount: number;
  /** VAPID public key, or null when push is not configured on the server. */
  vapidPublicKey: string | null;
  saveSubscription: (subscription: unknown) => Promise<ActionResult>;
  /** What clears the badge on this screen, shown after the count. */
  hint?: string;
};

function beep(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = BEEP_HZ;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + BEEP_SECONDS);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + BEEP_SECONDS);
    osc.onended = () => void ctx.close();
  } catch {
    // Audio can be blocked until the page has been interacted with; the badge still shows the count.
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function readAsked(): boolean {
  try {
    return window.localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAsked(): void {
  try {
    window.localStorage.setItem(ASKED_KEY, "1");
  } catch {
    // Private mode: the question may come back next visit, which is harmless.
  }
}

async function subscribe(vapidPublicKey: string): Promise<PushSubscription> {
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
}

/**
 * Plays a short sound when the alert count rises while the queue is open, and offers once per device
 * to turn on push alerts (browsers only allow the permission prompt after a tap).
 */
export function AlertSound({ alertCount, vapidPublicKey, saveSubscription, hint }: Props) {
  const previous = useRef<number | null>(null);
  const [offer, setOffer] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (previous.current !== null && alertCount > previous.current) beep();
    previous.current = alertCount;
  }, [alertCount]);

  useEffect(() => {
    const supported = vapidPublicKey !== null && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) return;
    if (Notification.permission === "granted") {
      // Already allowed on this device: make sure the server has this device (saving is idempotent).
      subscribe(vapidPublicKey)
        .then((sub) => saveSubscription(sub.toJSON()))
        .catch(() => setStatus("Push alerts could not be set up on this device."));
      return;
    }
    // Deferred so the prompt appears after the first paint, from browser-only state.
    const id = window.setTimeout(() => setOffer(Notification.permission === "default" && !readAsked()), 0);
    return () => window.clearTimeout(id);
  }, [vapidPublicKey, saveSubscription]);

  async function enable(): Promise<void> {
    writeAsked();
    setOffer(false);
    if (!vapidPublicKey) return;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("Push alerts are off. The queue still plays a sound while it is open.");
        return;
      }
      const result = await saveSubscription((await subscribe(vapidPublicKey)).toJSON());
      setStatus(result.message);
    } catch {
      setStatus("Push alerts could not be set up on this device.");
    }
  }

  function dismiss(): void {
    writeAsked();
    setOffer(false);
  }

  return (
    <div className="mb-4 grid gap-2">
      {alertCount > 0 && (
        <p role="status" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
          {alertCount === 1 ? "1 request alert" : `${alertCount} request alerts`} waiting for you.{hint ? ` ${hint}` : ""}
        </p>
      )}
      {offer && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-champagne bg-ivory px-3 py-2 text-sm">
          <span>Get request alerts on this device, even when this screen is closed.</span>
          <button type="button" onClick={enable} className={buttonPrimary}>Turn on alerts</button>
          <button type="button" onClick={dismiss} className={buttonQuiet}>Not now</button>
        </div>
      )}
      {status && <p className="text-xs text-charcoal/70">{status}</p>}
    </div>
  );
}
