import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { card, input, label } from "@/components/ui";
import { isFullySignedIn } from "@/server/auth/permissions";
import { currentActor, STAFF_BASE } from "@/server/auth/session-cookie";
import { loginAction } from "../actions";

export const metadata = { title: "Staff sign-in" };

export default async function LoginPage() {
  const actor = await currentActor();
  if (actor && isFullySignedIn(actor)) redirect(STAFF_BASE);
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-12">
      <h1 className="mb-6 font-display text-3xl text-navy">Staff sign-in</h1>
      <ActionForm action={loginAction} submitLabel="Sign in" className={card}>
        <div className="mb-4">
          <label className={label} htmlFor="hotelCode">Hotel code</label>
          <input className={input} id="hotelCode" name="hotelCode" required autoCapitalize="none" autoComplete="organization" />
        </div>
        <div className="mb-4">
          <label className={label} htmlFor="email">Email</label>
          <input className={input} id="email" name="email" type="email" required autoComplete="username" />
        </div>
        <div className="mb-5">
          <label className={label} htmlFor="password">Password</label>
          <input className={input} id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
      </ActionForm>
      <p className="mt-4 text-xs text-charcoal/60">Your hotel admin gives you the hotel code and your first password.</p>
    </main>
  );
}
