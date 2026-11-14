import { ActionForm } from "@/components/action-form";
import { card, input, label } from "@/components/ui";
import { listDepartments } from "@/server/admin/departments";
import { listStaff } from "@/server/admin/staff";
import { requireStaff } from "@/server/auth/session-cookie";
import { createStaffAction, resetStaffMfaAction, resetStaffPasswordAction, setStaffActiveAction, updateStaffRoleAction } from "../../actions";

export const metadata = { title: "Staff & roles" };

const ROLES = [
  ["EMPLOYEE", "Employee (needs department)"],
  ["SUPERVISOR", "Supervisor (needs department)"],
  ["GM", "General Manager (hotel-wide)"],
  ["HOTEL_ADMIN", "Hotel Admin (hotel-wide)"],
  ["FRONT_DESK", "Front desk (hotel-wide)"],
] as const;

export default async function StaffPage() {
  const actor = await requireStaff({ permission: "settings.view" });
  const [staff, departments] = await Promise.all([listStaff(actor), listDepartments(actor)]);
  const activeDepartments = departments.filter((d) => d.isActive);

  const roleFields = (role?: string, departmentId?: string | null) => (
    <>
      <div>
        <label className={label}>Role</label>
        <select className={input} name="role" defaultValue={role ?? "EMPLOYEE"} aria-label="Role">
          {ROLES.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
        </select>
      </div>
      <div>
        <label className={label}>Department</label>
        <select className={input} name="departmentId" defaultValue={departmentId ?? ""} aria-label="Department">
          <option value="">— none (hotel-wide) —</option>
          {activeDepartments.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.nameEn}</option>)}
        </select>
      </div>
    </>
  );

  return (
    <div className="grid gap-6">
      <section className={card}>
        <h2 className="mb-1 font-medium text-navy">Add a staff member</h2>
        <p className="mb-4 text-sm text-charcoal/70">They get a temporary password, shown once here. They choose their own at first sign-in.</p>
        <ActionForm action={createStaffAction} submitLabel="Create account">
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="name">Full name</label>
              <input className={input} id="name" name="name" required maxLength={80} />
            </div>
            <div>
              <label className={label} htmlFor="email">Email</label>
              <input className={input} id="email" name="email" type="email" required maxLength={160} />
            </div>
            {roleFields()}
          </div>
        </ActionForm>
      </section>

      <section className={card}>
        <h2 className="mb-4 font-medium text-navy">Staff ({staff.length})</h2>
        <ul className="grid gap-5">
          {staff.map((s) => {
            const m = s.memberships[0];
            const isSelf = s.id === actor.staffId;
            const locked = s.lockedUntil !== null && s.lockedUntil > new Date();
            return (
              <li key={s.id} data-staff-email={s.email} className="border-b border-soft-gray pb-5 last:border-0 last:pb-0">
                <p className="font-medium text-navy">
                  {s.name} {isSelf && <span className="text-xs font-normal text-charcoal/60">(you)</span>}
                </p>
                <p className="mb-3 text-sm text-charcoal/70">
                  {s.email} · {s.status === "ACTIVE" ? "Active" : "Disabled"}
                  {locked && " · Locked"}
                  {s.mustChangePassword && " · Temporary password"}
                  {s.mfaEnabledAt && " · 2-step on"}
                  {s.isDemo && " · Sample data"}
                </p>
                {!isSelf && (
                  <div className="grid gap-3">
                    <ActionForm action={updateStaffRoleAction} submitLabel="Save role" quiet className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                      <input type="hidden" name="staffId" value={s.id} />
                      {roleFields(m?.role, m?.departmentId)}
                    </ActionForm>
                    <div className="flex flex-wrap gap-3">
                      <ActionForm action={resetStaffPasswordAction} submitLabel="Reset password" quiet>
                        <input type="hidden" name="id" value={s.id} />
                      </ActionForm>
                      {s.mfaEnabledAt && (
                        <ActionForm action={resetStaffMfaAction} submitLabel="Reset 2-step" quiet>
                          <input type="hidden" name="id" value={s.id} />
                        </ActionForm>
                      )}
                      <ActionForm action={setStaffActiveAction} submitLabel={s.status === "ACTIVE" ? "Disable" : "Enable"} quiet>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="active" value={String(s.status !== "ACTIVE")} />
                      </ActionForm>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
