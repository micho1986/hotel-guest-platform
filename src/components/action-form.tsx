"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionResult, FormAction } from "@/server/forms";
import { buttonPrimary, buttonQuiet } from "./ui";

/**
 * A form wired to a server action. Shows the action's real result — success,
 * error, or a one-time secret such as a temporary password — and disables the
 * button while the request is in flight.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  quiet = false,
  className = "",
}: {
  action: FormAction;
  children?: ReactNode;
  submitLabel: string;
  quiet?: boolean;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      <button type="submit" disabled={pending} className={quiet ? buttonQuiet : buttonPrimary}>
        {pending ? "Working…" : submitLabel}
      </button>
      {state && (
        <p role="status" className={`mt-2 text-sm ${state.ok ? "text-green-800" : "text-red-700"}`}>
          {state.message}
        </p>
      )}
      {state?.ok && state.secret && (
        <p className="mt-2 rounded-lg border border-champagne bg-ivory px-3 py-2 text-sm">
          <span className="block text-xs text-charcoal/70">{state.secret.label}</span>
          <code data-testid="secret" className="font-mono text-base font-semibold text-navy select-all">
            {state.secret.value}
          </code>
        </p>
      )}
    </form>
  );
}
