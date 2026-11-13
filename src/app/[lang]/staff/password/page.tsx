import { ActionForm } from "@/components/action-form";
import { card, input, label } from "@/components/ui";
import { MIN_PASSWORD_LENGTH } from "@/server/auth/passwords";
import { requireStaff } from "@/server/auth/session-cookie";
import { changePasswordAction } from "../actions";

export const metadata = { title: "Change password" };

export default async function PasswordPage() {
  const actor = await requireStaff({ stage: "password" });
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-12">
      <h1 className="mb-2 font-display text-3xl text-navy">{actor.mustChangePassword ? "Choose your password" : "Change password"}</h1>
      <p className="mb-6 text-sm text-charcoal/70">
        {actor.mustChangePassword && "You signed in with a temporary password. "}
        Use at least {MIN_PASSWORD_LENGTH} characters, with letters and numbers.
      </p>
      <ActionForm action={changePasswordAction} submitLabel="Save password" className={card}>
        <div className="mb-4">
          <label className={label} htmlFor="currentPassword">{actor.mustChangePassword ? "Temporary password" : "Current password"}</label>
          <input className={input} id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" />
        </div>
        <div className="mb-4">
          <label className={label} htmlFor="newPassword">New password</label>
          <input className={input} id="newPassword" name="newPassword" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
        </div>
        <div className="mb-5">
          <label className={label} htmlFor="confirmPassword">New password again</label>
          <input className={input} id="confirmPassword" name="confirmPassword" type="password" required autoComplete="new-password" />
        </div>
      </ActionForm>
    </main>
  );
}
