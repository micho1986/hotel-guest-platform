import { ActionForm } from "@/components/action-form";
import { card, input, label } from "@/components/ui";
import { listCatalogue } from "@/server/admin/catalogue";
import { listDepartments } from "@/server/admin/departments";
import { requireStaff } from "@/server/auth/session-cookie";
import { createServiceItemAction, setCategoryActiveAction, setServiceItemActiveAction, updateServiceItemAction } from "../../actions";

export const metadata = { title: "Services" };

type ItemValues = {
  nameEn?: string; nameAr?: string; descriptionEn?: string | null; descriptionAr?: string | null;
  departmentId?: string; maxQty?: number; needsNote?: boolean; safetyCritical?: boolean;
};

export default async function ServicesPage() {
  const actor = await requireStaff({ permission: "settings.view" });
  const [categories, departments] = await Promise.all([listCatalogue(actor), listDepartments(actor)]);
  const activeDepartments = departments.filter((d) => d.isActive);

  const itemFields = (v: ItemValues = {}) => (
    <div className="mb-3 grid gap-3 sm:grid-cols-2">
      <div>
        <label className={label}>Name (English)</label>
        <input className={input} name="nameEn" defaultValue={v.nameEn} required maxLength={80} aria-label="Name (English)" />
      </div>
      <div>
        <label className={label}>Name (Arabic)</label>
        <input className={input} name="nameAr" defaultValue={v.nameAr} required maxLength={80} dir="rtl" aria-label="Name (Arabic)" />
      </div>
      <div>
        <label className={label}>Description (English, optional)</label>
        <input className={input} name="descriptionEn" defaultValue={v.descriptionEn ?? ""} maxLength={300} aria-label="Description (English)" />
      </div>
      <div>
        <label className={label}>Description (Arabic, optional)</label>
        <input className={input} name="descriptionAr" defaultValue={v.descriptionAr ?? ""} maxLength={300} dir="rtl" aria-label="Description (Arabic)" />
      </div>
      <div>
        <label className={label}>Goes to department</label>
        <select className={input} name="departmentId" defaultValue={v.departmentId} required aria-label="Department">
          {activeDepartments.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.nameEn}</option>)}
        </select>
      </div>
      <div>
        <label className={label}>Most a guest can ask for at once</label>
        <input className={input} name="maxQty" type="number" min={1} max={20} defaultValue={v.maxQty ?? 1} required aria-label="Maximum quantity" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="needsNote" defaultChecked={v.needsNote} /> Guest must describe the request
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="safetyCritical" defaultChecked={v.safetyCritical} /> Safety-critical (alerts the GM at once)
      </label>
    </div>
  );

  return (
    <div className="grid gap-6">
      <p className="text-sm text-charcoal/70">
        Categories are the tiles guests see. Each service inside a category goes to one department. Hidden categories and services don&apos;t appear to guests.
      </p>
      {categories.map((c) => (
        <section key={c.id} className={card} data-category={c.key}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-medium text-navy">{c.nameEn} · <span className="font-normal text-charcoal/60" dir="rtl">{c.nameAr}</span></h2>
              <p className="text-sm text-charcoal/70">{c.isActive ? "Shown to guests" : "Hidden from guests"} · {c.items.length} service{c.items.length === 1 ? "" : "s"}</p>
            </div>
            <ActionForm action={setCategoryActiveAction} submitLabel={c.isActive ? "Hide category" : "Show category"} quiet>
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="active" value={String(!c.isActive)} />
            </ActionForm>
          </div>
          <ul className="grid gap-2">
            {c.items.map((item) => (
              <li key={item.id}>
                <details className="rounded-lg border border-soft-gray px-3 py-2">
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium">{item.nameEn}</span> → {item.department.code}
                    {!item.isActive && " · hidden"}
                    {item.safetyCritical && " · safety-critical"}
                  </summary>
                  <div className="pt-3">
                    <ActionForm action={updateServiceItemAction} submitLabel="Save service" quiet>
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="categoryId" value={c.id} />
                      {itemFields(item)}
                    </ActionForm>
                    <ActionForm action={setServiceItemActiveAction} submitLabel={item.isActive ? "Hide service" : "Show service"} quiet className="mt-3">
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="active" value={String(!item.isActive)} />
                    </ActionForm>
                  </div>
                </details>
              </li>
            ))}
            <li>
              <details className="rounded-lg border border-dashed border-soft-gray px-3 py-2">
                <summary className="cursor-pointer text-sm text-navy">+ Add a service to {c.nameEn}</summary>
                <div className="pt-3">
                  <ActionForm action={createServiceItemAction} submitLabel="Add service" quiet>
                    <input type="hidden" name="categoryId" value={c.id} />
                    {itemFields()}
                  </ActionForm>
                </div>
              </details>
            </li>
          </ul>
        </section>
      ))}
    </div>
  );
}
