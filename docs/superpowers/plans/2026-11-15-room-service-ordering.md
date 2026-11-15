# Room-service ordering with the Ostro menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guest with an active stay orders several Ostro menu items in one cart; the order reaches Food & Beverage as one request with its lines and total.

**Architecture:** The Ostro menu (copied unchanged to `prisma/data/ostro-menu.sql`) is parsed and imported into the hotel's existing service catalogue, idempotently, keyed by `externalKey`. Every order uses one hidden umbrella catalogue item routed to F&B, so SLA, queue, alerts, transfer and chat are reused. A new `ServiceOrder` with `ServiceOrderLine` rows holds the lines, with names and prices copied at order time. Prices are read by the server only.

**Tech Stack:** Next.js 16 App Router, React, Prisma 7 + PostgreSQL 16 (RLS), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-15-room-service-ordering-design.md`

## Global Constraints

- Currency is AED; prices are whole units from the Ostro file, stored as `Decimal(12,2)`.
- Menu copy is exactly as in Ostro: 17 categories, 120 products. No name, description, price or availability is edited by the import.
- `nameAr` holds the English name until Arabic translations exist (ruling R1).
- Payment: pay on delivery only. The app records no payment.
- Each order line quantity is 1 to 20 inclusive.
- Orders are allowed only on a stay with `status = ACTIVE` and no `tokenRevokedAt`.
- Staff routing: every order goes to the Food & Beverage department (`code = 'FB'`).

## Review Focus

1. A forged browser price or a deactivated item in the cart is ignored or refused; the server total is authoritative.
2. Empty cart, qty 0, qty 21, non-integer qty, or an unknown item id is refused with no request created.
3. A stay checked out after the menu loaded is refused at submit time.
4. Re-running the import creates no duplicate rows; a changed Ostro price updates the catalogue; a product removed from the file becomes inactive, not deleted.
5. Changing a catalogue price after an order does not change that order's lines or total.

## Rulings made in this plan

- **R1** Arabic name placeholder: `nameAr = nameEn` until translations exist. Cost if wrong: Arabic guests see English until translations are added.
- **R2** `ServiceItem` gets `externalKey` (nullable, unique per hotel). Ostro product ids map to `ostro-<id>`; the umbrella item uses `room-service-order`. The spec did not name a stable key, and Ostro ids alone are not unique across hotels. Cost if wrong: one migration to change it.
- **R3** The umbrella category has key `room-service-orders` and `isActive = false`, so it never appears in the guest menu. Cost if wrong: an empty category shows to guests; the Task 6 test catches it.
- **R4** `submitGuestRequest` gains an optional `afterCreate(tx, requestId)` callback that runs inside the same transaction. This makes the order and its request atomic without copying the routing logic. Cost if wrong: a refactor in a shipped path; the existing request tests guard it.
- **R5** Umbrella item is `maxQty = 1`, `needsNote = false`, `price = null`.

---

### Task 1: Schema for order lines and external keys

**Files:**
- Modify: `prisma/schema.prisma` (add `externalKey` to `ServiceItem`; add `ServiceOrder` and `ServiceOrderLine` models; relations on `Request`, `Hotel`, `Stay`, `ServiceItem`)
- Create: `prisma/migrations/20261115000100_room_service_orders/migration.sql`
- Test: `test/room-service-schema.test.ts`

**Interfaces:**
- Produces: `ServiceItem.externalKey: string | null` (unique with `hotelId`); `ServiceOrder { id, hotelId, requestId (unique), createdAt }`; `ServiceOrderLine { id, hotelId, orderId, serviceItemId, nameSnapshot, unitPrice: Decimal, qty: Int }`.

- [ ] **Step 1: Write the failing test**

```ts
// test/room-service-schema.test.ts
import { afterAll, describe, expect, it } from "vitest";
import { adminDb, createHotelWithData } from "./fixtures";

afterAll(async () => { await adminDb.$disconnect(); });

describe("room service schema", () => {
  it("a catalogue item can carry an external key, unique per hotel", async () => {
    const { hotelId, dept, item } = await createHotelWithData("rs-schema");
    await adminDb.serviceItem.update({ where: { id: item.id }, data: { externalKey: "ostro-1" } });
    await expect(
      adminDb.serviceItem.create({ data: { ...sameShapeAs(item, hotelId, dept.id), externalKey: "ostro-1" } }),
    ).rejects.toThrow();
  });

  it("an order line keeps its name and price after the catalogue item changes", async () => {
    const { hotelId, item, request } = await createHotelWithData("rs-line");
    const order = await adminDb.serviceOrder.create({ data: { hotelId, requestId: request.id } });
    await adminDb.serviceOrderLine.create({
      data: { hotelId, orderId: order.id, serviceItemId: item.id, nameSnapshot: "Shakshuka", unitPrice: "59", qty: 2 },
    });
    await adminDb.serviceItem.update({ where: { id: item.id }, data: { price: "99" } });
    const line = await adminDb.serviceOrderLine.findFirstOrThrow({ where: { orderId: order.id } });
    expect(line.nameSnapshot).toBe("Shakshuka");
    expect(Number(line.unitPrice)).toBe(59);
  });
});
```

Note for the implementer: `createHotelWithData` in `test/fixtures.ts` returns the hotel, department, catalogue item and request. If it does not return `request`, create one with the existing request helper in `test/fixtures.ts`. `sameShapeAs` is a local helper that copies the item's required fields.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/room-service-schema.test.ts`
Expected: FAIL — `externalKey`/`serviceOrder` do not exist on the Prisma client.

- [ ] **Step 3: Add the models and relations to `prisma/schema.prisma`**

Add `externalKey String? @map("external_key")` to `ServiceItem` and `@@unique([hotelId, externalKey])`. Add `ServiceOrder` (`@@map("service_orders")`, unique `requestId`, relation to `Request`) and `ServiceOrderLine` (`@@map("service_order_lines")`, `unitPrice Decimal @db.Decimal(12, 2)`, `qty Int`, relation to `ServiceOrder` with cascade delete, relation to `ServiceItem`). Add the back-relations on `Hotel`, `Request`, `ServiceItem`.

- [ ] **Step 4: Generate the migration and add RLS**

Run: `pnpm prisma migrate dev --create-only --name room_service_orders`, then move the generated folder to the timestamp above. Append the RLS policies that `prisma/migrations/20261114000200_m4_chat/migration.sql` uses for its tables, applied to `service_orders` and `service_order_lines`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm db:migrate && pnpm prisma generate && pnpm vitest run test/room-service-schema.test.ts`
Expected: migrations applied; 2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma test/room-service-schema.test.ts
git commit -m "M5: room service order schema and external item key"
```

---

### Task 2: Parse the Ostro menu file

**Files:**
- Create: `src/server/room-service/ostro-menu.ts`
- Test: `test/ostro-menu-parse.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type OstroCategory = { id: number; name: string; sort: number };
  export type OstroProduct = { id: number; categoryId: number; name: string; description: string; price: number; available: boolean; sort: number };
  export type OstroMenu = { categories: OstroCategory[]; products: OstroProduct[] };
  export function parseOstroMenu(sql: string): OstroMenu;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// test/ostro-menu-parse.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseOstroMenu } from "@/server/room-service/ostro-menu";

const sql = readFileSync("prisma/data/ostro-menu.sql", "utf8");
const menu = parseOstroMenu(sql);

describe("parseOstroMenu", () => {
  it("reads all 17 categories and 120 products", () => {
    expect(menu.categories).toHaveLength(17);
    expect(menu.products).toHaveLength(120);
  });

  it("unescapes doubled single quotes", () => {
    expect(menu.categories.find((c) => c.id === 4)?.name).toBe("O'Vegan");
  });

  it("reads product 1 exactly", () => {
    expect(menu.products.find((p) => p.id === 1)).toEqual({
      id: 1, categoryId: 1, name: "Poached Eggs on Toast",
      description: "Poached eggs on rye with avocado, tomato, beetroot labneh and dukkah.",
      price: 59, available: true, sort: 1,
    });
  });

  it("reads an unavailable product as available: false", () => {
    expect(menu.products.some((p) => p.available === false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/ostro-menu-parse.test.ts`
Expected: FAIL — module `@/server/room-service/ostro-menu` not found.

- [ ] **Step 3: Implement `parseOstroMenu`**

Scan the text for the `INSERT OR IGNORE INTO categories` and `INSERT OR IGNORE INTO products` statements and read each `( ... )` tuple after `VALUES`. Parse SQL string literals with `''` as an escaped quote, `NULL` as null, and integers as numbers. Map columns by the order in each statement's column list. Ignore the `settings` statement. Throw an error if a tuple has the wrong number of values.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run test/ostro-menu-parse.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/room-service/ostro-menu.ts test/ostro-menu-parse.test.ts
git commit -m "M5: parse the copied Ostro menu file"
```

---

### Task 3: Idempotent catalogue import

**Files:**
- Create: `src/server/room-service/import.ts`
- Test: `test/room-service-import.test.ts`

**Interfaces:**
- Consumes: `OstroMenu` from Task 2; `ServiceItem.externalKey` from Task 1.
- Produces:
  ```ts
  export const ROOM_SERVICE_CATEGORY_KEY = "room-service-orders";
  export const ROOM_SERVICE_ITEM_KEY = "room-service-order";
  export function importOstroMenu(hotelId: string, menu: OstroMenu): Promise<{ categories: number; items: number }>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// test/room-service-import.test.ts
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importOstroMenu, ROOM_SERVICE_CATEGORY_KEY, ROOM_SERVICE_ITEM_KEY } from "@/server/room-service/import";
import { parseOstroMenu } from "@/server/room-service/ostro-menu";
import { adminDb, createHotelWithData } from "./fixtures";

const menu = parseOstroMenu(readFileSync("prisma/data/ostro-menu.sql", "utf8"));
let hotelId: string;

beforeAll(async () => { hotelId = (await createHotelWithData("rs-import")).hotelId; });
afterAll(async () => { await adminDb.$disconnect(); });

describe("importOstroMenu", () => {
  it("creates 17 categories and 120 items plus the hidden umbrella item", async () => {
    await importOstroMenu(hotelId, menu);
    expect(await adminDb.serviceCategory.count({ where: { hotelId, key: { startsWith: "ostro-" } } })).toBe(17);
    expect(await adminDb.serviceItem.count({ where: { hotelId, externalKey: { startsWith: "ostro-" } } })).toBe(120);
  });

  it("is idempotent: a second run creates no duplicates", async () => {
    await importOstroMenu(hotelId, menu);
    expect(await adminDb.serviceItem.count({ where: { hotelId, externalKey: { startsWith: "ostro-" } } })).toBe(120);
  });

  it("uses the Ostro name and price unchanged, with the English name as the Arabic placeholder", async () => {
    const item = await adminDb.serviceItem.findFirstOrThrow({ where: { hotelId, externalKey: "ostro-1" } });
    expect(item).toMatchObject({ nameEn: "Poached Eggs on Toast", nameAr: "Poached Eggs on Toast", isActive: true });
    expect(Number(item.price)).toBe(59);
  });

  it("a changed Ostro price updates the item; a product removed from the file is deactivated, not deleted", async () => {
    const changed = { ...menu, products: menu.products.map((p) => (p.id === 1 ? { ...p, price: 65 } : p)).filter((p) => p.id !== 2) };
    await importOstroMenu(hotelId, changed);
    expect(Number((await adminDb.serviceItem.findFirstOrThrow({ where: { hotelId, externalKey: "ostro-1" } })).price)).toBe(65);
    const gone = await adminDb.serviceItem.findFirstOrThrow({ where: { hotelId, externalKey: "ostro-2" } });
    expect(gone.isActive).toBe(false);
    await importOstroMenu(hotelId, menu);
  });

  it("the umbrella item routes to Food & Beverage and its category is hidden from guests", async () => {
    const umbrella = await adminDb.serviceItem.findFirstOrThrow({ where: { hotelId, externalKey: ROOM_SERVICE_ITEM_KEY } });
    const fb = await adminDb.department.findFirstOrThrow({ where: { hotelId, code: "FB" } });
    expect(umbrella).toMatchObject({ departmentId: fb.id, maxQty: 1, needsNote: false });
    const cat = await adminDb.serviceCategory.findFirstOrThrow({ where: { hotelId, key: ROOM_SERVICE_CATEGORY_KEY } });
    expect(cat.isActive).toBe(false);
  });
});
```

Implementer note: `createHotelWithData` must create a department with code `FB`. If the fixture does not, add one to the test's `beforeAll` with `adminDb.department.create`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/room-service-import.test.ts`
Expected: FAIL — module `@/server/room-service/import` not found.

- [ ] **Step 3: Implement `importOstroMenu`**

Inside one `adminDb` transaction: upsert the umbrella category (key `room-service-orders`, `isActive: false`) and umbrella item (`externalKey: "room-service-order"`, department `FB`, `maxQty: 1`, `price: null`). For each Ostro category, upsert by `(hotelId, key = "ostro-<id>")` with `nameEn = nameAr = name`, `sort`. For each product, upsert by `(hotelId, externalKey = "ostro-<id>")` with `nameEn = nameAr = name`, `descriptionEn = descriptionAr = description || null`, `price`, `isActive = available`, `categoryId` of its Ostro category. For items in the hotel with an `ostro-` key that are absent from the file, set `isActive = false`. Never delete rows. Return the counts.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run test/room-service-import.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/room-service/import.ts test/room-service-import.test.ts
git commit -m "M5: idempotent import of the Ostro menu into the catalogue"
```

---

### Task 4: Import command

**Files:**
- Create: `scripts/import-ostro-menu.ts`
- Modify: `package.json` (add script `"menu:import-ostro": "tsx scripts/import-ostro-menu.ts"`)

**Interfaces:**
- Consumes: `parseOstroMenu` (Task 2), `importOstroMenu` (Task 3).

- [ ] **Step 1: Write the script**

It reads `prisma/data/ostro-menu.sql`, parses it, and imports into the hotel whose slug is given by `HOTEL_SLUG` (default: the only hotel in the database; error if there are several). It prints the counts.

- [ ] **Step 2: Run it twice and verify**

Run: `pnpm menu:import-ostro && pnpm menu:import-ostro`
Expected: both runs print `categories: 17, items: 120`; the second run creates no new rows.

- [ ] **Step 3: Commit**

```bash
git add scripts/import-ostro-menu.ts package.json
git commit -m "M5: command to import the Ostro menu"
```

---

### Task 5: Place an order atomically

**Files:**
- Modify: `src/server/guest-requests.ts` (add `afterCreate` option to `submitGuestRequest`, per R4)
- Create: `src/server/room-service/orders.ts`
- Test: `test/room-service-orders.test.ts`

**Interfaces:**
- Consumes: `ROOM_SERVICE_ITEM_KEY` (Task 3); `GuestStay` from `@/server/guest`; `GuestRequestResult` from `@/server/guest-requests`.
- Produces:
  ```ts
  export type OrderLineInput = { serviceItemId: string; qty: number };
  export function placeServiceOrder(
    guest: GuestStay,
    input: { lines: OrderLineInput[]; guestNote: string | null },
    sender?: PushSender | null,
  ): Promise<GuestRequestResult & { orderId?: string }>;
  ```
- Changed: `submitGuestRequest(guest, input, sender?, afterCreate?: (tx: TenantTx, requestId: string) => Promise<void>)`.

- [ ] **Step 1: Write the failing tests**

Tests in `test/room-service-orders.test.ts`, each in its own `it`:
1. "places one request in F&B with one order and its lines": two Ostro items qty 2 and 1; expect `ok`, one `Request` with `serviceItemId` = umbrella item, `departmentId` = FB, `qty = 1`; one `ServiceOrder` linked to it; two `ServiceOrderLine` rows with `nameSnapshot` and `unitPrice` from the catalogue; `total` is the sum.
2. "ignores a price sent by the browser": pass `unitPrice` in the input object cast to any; the stored price is the catalogue price.
3. "refuses an inactive item and creates nothing": set one item `isActive: false`; expect `ok: false`; count of `Request` unchanged.
4. "refuses an empty cart": `lines: []`; `ok: false`.
5. "refuses qty 0, qty 21 and a non-integer qty": each `ok: false`.
6. "refuses a stay that is not active": set stay `status` to `CHECKED_OUT`; `ok: false`.
7. "rolls back the request when the order cannot be saved": pass a line whose `serviceItemId` is a valid id of an item from another hotel; expect `ok: false`, and count of `Request` in this hotel unchanged.
8. "after a catalogue price change the order keeps its price": place the order, change the item's price, read the line; price is the old one.

Each test uses `createHotelWithData`, the Ostro import from Task 3 on the test hotel, and a guest from the existing guest fixture.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run test/room-service-orders.test.ts`
Expected: FAIL — `placeServiceOrder` not found.

- [ ] **Step 3: Add the `afterCreate` option (R4)**

In `submitGuestRequest`, add an optional fourth parameter. Call it inside the `tenantTransaction` callback after the request and its first event are created, passing `tx` and `request.id`. When absent, behaviour is unchanged. Run `pnpm vitest run test/guest-requests.test.ts` after this edit; it must still pass.

- [ ] **Step 4: Implement `placeServiceOrder`**

Validate: `lines` is a non-empty array of at most 50 entries; each `qty` is an integer from 1 to 20. Load the umbrella item by `externalKey = "room-service-order"` in the guest's hotel. Load the requested items with `isActive: true, deletedAt: null, department code FB`, using the catalogue `price`. If any requested item is missing, refuse with "One or more items are not available." Compute the total. Call `submitGuestRequest` with `serviceItemId` = umbrella id, `qty: 1`, `guestNote`, and an `afterCreate` that creates the `ServiceOrder` and its `ServiceOrderLine` rows with `nameSnapshot`, `unitPrice`, `qty`. Return the result with `orderId`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run test/room-service-orders.test.ts test/guest-requests.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/guest-requests.ts src/server/room-service/orders.ts test/room-service-orders.test.ts
git commit -m "M5: place a room-service order as one request with lines"
```

---

### Task 6: Guest menu page and cart

**Files:**
- Create: `src/server/room-service/menu.ts` (`listRoomServiceMenu(guest)`)
- Create: `src/app/[lang]/g/[token]/menu/page.tsx`
- Create: `src/app/[lang]/g/[token]/menu/actions.ts`
- Create: `src/components/room-service-cart.tsx` (client component; cart kept in `sessionStorage` under `room-service:<token>`)
- Modify: `src/app/[lang]/g/[token]/page.tsx` (add a link to the menu)
- Test: `test/room-service-menu.test.ts`

**Interfaces:**
- Consumes: `placeServiceOrder` (Task 5), `ROOM_SERVICE_CATEGORY_KEY` (Task 3).
- Produces: `listRoomServiceMenu(guest: GuestStay): Promise<{ key: string; nameEn: string; items: { id: string; nameEn: string; descriptionEn: string | null; price: number }[] }[]>`.

- [ ] **Step 1: Write the failing test**

1. "lists the Ostro categories and their available items, never the umbrella": expect 17 categories; none with key `room-service-orders`; each item's `price` is a number; an inactive item is absent.
2. "returns nothing when the stay is not active": guest on a checked-out stay gets `[]`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run test/room-service-menu.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `listRoomServiceMenu`, the page, the action and the cart**

- `listRoomServiceMenu`: check the stay is active (as in `submitGuestRequest`), then list active categories with `key` starting `ostro-`, ordered by `sort`, each with its active items ordered by `sort`.
- The page: header from `listRoomServiceMenu`, then a list of categories with items, each with a quantity control (0 to 20) and the cart component.
- `room-service-cart.tsx`: a client component that keeps `{ serviceItemId: qty }` in `sessionStorage`, shows a running total from the displayed prices, a note field, and a submit button. Submit calls the server action with only ids and quantities.
- `actions.ts`: `"use server"`; resolves the guest token; calls `placeServiceOrder`; on success clears the cart from the client and redirects to `/[lang]/g/[token]/requests/<requestId>`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run test/room-service-menu.test.ts test/guest-pages.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/room-service/menu.ts src/app/[lang]/g/[token]/menu src/components/room-service-cart.tsx src/app/[lang]/g/[token]/page.tsx test/room-service-menu.test.ts
git commit -m "M5: guest room-service menu and cart"
```

---

### Task 7: Staff sees the order lines

**Files:**
- Modify: `src/server/requests/staff.ts` (`getRequestForStaff` also returns the order's lines and total when the request has an order)
- Modify: `src/app/[lang]/staff/requests/[requestId]/page.tsx` (render the lines and total)
- Test: `test/room-service-staff.test.ts`

**Interfaces:**
- Changed: `getRequestForStaff` result gains `order: { lines: { nameSnapshot: string; qty: number; unitPrice: number }[]; total: number } | null`.

- [ ] **Step 1: Write the failing test**

1. "a staff member in F&B sees the order's lines and total": place an order (Task 5 helper), call `getRequestForStaff` as an F&B employee; expect `order.lines` with the right names and quantities, `total` equal to the sum.
2. "a housekeeping employee cannot see the order": `getRequestForStaff` returns `null`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run test/room-service-staff.test.ts`
Expected: FAIL — `order` is missing.

- [ ] **Step 3: Implement**

Include `serviceOrder: { include: { lines: true } }` in the existing query inside `getRequestForStaff` and map it to the `order` shape. In the page, render the lines as a list (name, quantity, price) below the request details, only when `order` is not null.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run test/room-service-staff.test.ts test/staff-requests.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/requests/staff.ts "src/app/[lang]/staff/requests/[requestId]/page.tsx" test/room-service-staff.test.ts
git commit -m "M5: staff see room-service order lines"
```

---

### Task 8: Full verification

- [ ] **Step 1: Run the whole suite**

Run: `pnpm test`
Expected: all test files PASS, including the existing M2–M4 suites. Record the count.

- [ ] **Step 2: Typecheck, lint and build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: all three succeed with no errors.

- [ ] **Step 3: Browser check on the phone**

Run `pnpm dev -H 0.0.0.0`, reissue a QR on a checked-in stay, open `/en/g/<token>/menu` on the phone, add two items, place the order, and confirm the request appears in the Food & Beverage queue with its lines.

- [ ] **Step 4: Report**

List the rulings (R1–R5) and any deferred minors in the final message. Do not commit the final report; leave the branch for review.

---

## Self-Review

- **Spec coverage:** menu copy and import (Tasks 2–4); one umbrella item and F&B routing (Tasks 1, 3, 5); one cart, one order with lines (Tasks 1, 5, 6); server pricing and rejections (Task 5); staff sees lines (Task 7); pay on delivery and English only (Global Constraints); idempotent import (Task 3); stay required (Tasks 5, 6). All acceptance criteria 1–7 map to a task.
- **Type consistency:** `OstroMenu` (Task 2) is consumed as-is by `importOstroMenu` (Task 3); `ROOM_SERVICE_ITEM_KEY` and `ROOM_SERVICE_CATEGORY_KEY` are defined once in Task 3 and used in Tasks 5 and 6; `GuestRequestResult` is reused from `guest-requests.ts`.
- **Gaps noted for the implementer:** the test fixture may need an `FB` department and a request helper; Task 1 and Task 5 say so explicitly.
