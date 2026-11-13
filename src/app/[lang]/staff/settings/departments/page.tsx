import { ActionForm } from "@/components/action-form";
import { card, input, label } from "@/components/ui";
import { listDepartments } from "@/server/admin/departments";
import { requireStaff } from "@/server/auth/session-cookie";
import { createDepartmentAction, updateDepartmentAction } from "../../actions";

export const metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  const actor = await requireStaff({ permission: "settings.view" });
  const departments = await listDepartments(actor);
  return (
    <div className="grid gap-6">
      <section className={card}>
        <h2 className="mb-4 font-medium text-navy">Departments ({departments.length})</h2>
        <ul className="grid gap-4">
          {departments.map((d) => (
            <li key={d.id} className="border-b border-soft-gray pb-4 last:border-0 last:pb-0">
              <ActionForm action={updateDepartmentAction} submitLabel="Save" quiet className="grid items-end gap-3 sm:grid-cols-[5rem_1fr_1fr_auto_auto]">
                <input type="hidden" name="id" value={d.id} />
                <span className="pb-2 font-mono text-sm font-semibold text-navy">{d.code}</span>
                <div>
                  <label className={label}>Name (English)</label>
                  <input className={input} name="nameEn" defaultValue={d.nameEn} required maxLength={80} aria-label={`${d.code} English name`} />
                </div>
                <div>
                  <label className={label}>Name (Arabic)</label>
                  <input className={input} name="nameAr" defaultValue={d.nameAr} required maxLength={80} dir="rtl" aria-label={`${d.code} Arabic name`} />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input type="checkbox" name="isActive" defaultChecked={d.isActive} /> Active
                </label>
              </ActionForm>
            </li>
          ))}
        </ul>
      </section>
      <section className={card}>
        <h2 className="mb-4 font-medium text-navy">Add a department</h2>
        <ActionForm action={createDepartmentAction} submitLabel="Add department">
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <div>
              <label className={label} htmlFor="code">Code</label>
              <input className={input} id="code" name="code" required maxLength={10} placeholder="SPA" />
            </div>
            <div>
              <label className={label} htmlFor="nameEn">Name (English)</label>
              <input className={input} id="nameEn" name="nameEn" required maxLength={80} />
            </div>
            <div>
              <label className={label} htmlFor="nameAr">Name (Arabic)</label>
              <input className={input} id="nameAr" name="nameAr" required maxLength={80} dir="rtl" />
            </div>
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
