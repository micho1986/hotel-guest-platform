# M2 Guest Access and Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native, one session) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guests scan a room QR code, browse services, submit catalogue or concierge requests in English or Arabic, and see their requests. Front desk checks guests in, prints QR cards, reissues tokens and checks guests out.

**Architecture:** Guest access is a token in the URL path, resolved by the existing `resolve_guest_stay` function, then every guest query is scoped to the stay and hotel through `tenantDb`. Staff check-in is a service in `src/server/admin/stays.ts` with the same permission and validation pattern as M1. The new `FRONT_DESK` role is added through a hand-written migration.

**Tech Stack:** Next.js 16 App Router (`[lang]` segment, server actions), Prisma 7 with the `prisma-client` generator, PostgreSQL 16 with RLS, Zod 4, Vitest, Playwright-core, `qrcode`.

**Spec:** `docs/superpowers/specs/2026-11-14-m2-guest-access-design.md`

## Global Constraints

- Every tenant query goes through `tenantDb(hotelId)`; no raw `appDb()` calls in guest or staff code paths.
- Guest tokens: 32 random bytes, base64url; only SHA-256 hex stored (`hashAccessToken`).
- Permission checks happen inside services via `dbFor(actor, permission)` or `assertCan`; server actions only pass form values through.
- Request events and audit logs are insert-only.
- No success message is shown until the database write has returned.
- Demo data only (`isDemo: true` on seed rows).
- URLs use `/en` or `/ar`; Arabic pages set `dir="rtl"` through the existing layout.
- Migrations are hand-written SQL in `prisma/migrations/<timestamp>_<name>/migration.sql`, one folder per change.

## Review Focus

1. **Two active stays in one room** (two front-desk users check in at once). Expected: second check-in fails with "This room already has a guest." Test in Task 2.
2. **Request after check-out or after token reissue**. Expected: guest sees "This link is no longer active." and cannot submit. Test in Task 3.
3. **Quantity above `maxQty` or zero**. Expected: rejected with a field error, nothing written. Test in Task 3.
4. **Concierge request with blank or whitespace-only note**. Expected: rejected, not stored as an empty note. Test in Task 3.
5. **Very long or malformed token in the URL** (for example 10,000 characters, or non-base64url characters). Expected: 404, no database query made with the raw value. Test in Task 4.

---

### Task 1: Front-desk role

**Files:**
- Modify: `prisma/schema.prisma` (enum `StaffRole`)
- Create: `prisma/migrations/20261114000000_front_desk_role/migration.sql`
- Modify: `src/server/auth/permissions.ts` (GRANTS)
- Modify: `src/server/admin/staff.ts` (line 11 `ROLES`)
- Modify: `src/app/[lang]/staff/page.tsx` (line 9 `ROLE_LABEL`)
- Modify: `src/app/[lang]/staff/settings/staff/page.tsx` (role options, around line 14)
- Test: `test/permissions.test.ts` (extend `test/admin.test.ts` if it already covers permissions)

**Interfaces:**
- Consumes: existing `can`, `assertCan`, `hasRole` in `permissions.ts`.
- Produces: `Permission` gains `"stays.view" | "stays.manage"`. `StaffRole` gains `"FRONT_DESK"`.

- [ ] **Step 1: Write failing permission tests**

```ts
it("front desk can manage stays but not settings", () => {
  const actor = actorWith("FRONT_DESK");
  expect(can(actor, "stays.manage")).toBe(true);
  expect(can(actor, "stays.view")).toBe(true);
  expect(can(actor, "settings.view")).toBe(false);
});

it("front desk does not need MFA", () => {
  const actor = actorWith("FRONT_DESK", { mfaEnrolled: false, mfaVerified: false });
  expect(isFullySignedIn(actor)).toBe(true);
});

it("employees cannot check guests in", () => {
  expect(can(actorWith("EMPLOYEE"), "stays.manage")).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test test/admin.test.ts`
Expected: FAIL, with `stays.manage` not a known permission.

- [ ] **Step 3: Add the enum value, migration and grants**

- Add `FRONT_DESK` to `enum StaffRole` in `schema.prisma`.
- Migration SQL: `ALTER TYPE "StaffRole" ADD VALUE 'FRONT_DESK';`
- In `GRANTS`: `"stays.view": ["FRONT_DESK", "SUPERVISOR", "GM", "HOTEL_ADMIN"]` and `"stays.manage"` the same list.
- Add `"FRONT_DESK"` to `ROLES` in `staff.ts`, and `FRONT_DESK: "Front desk"` to `ROLE_LABEL`.
- Add `["FRONT_DESK", "Front desk (hotel-wide)"]` to the role options in the staff settings page.
- Do not add `FRONT_DESK` to `DEPARTMENT_ROLES`; it is hotel-wide.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Verify migration applies**

Run: apply every `prisma/migrations/*/migration.sql` in order to `hotel_test` with `psql` (as the test global setup does), then confirm `SELECT unnest(enum_range(NULL::"StaffRole"));` lists `FRONT_DESK`.
Expected: `FRONT_DESK` listed.

- [ ] **Step 6: Commit**

```bash
git add prisma src/server/auth/permissions.ts src/server/admin/staff.ts "src/app/[lang]/staff" test
git commit -m "M2: add front-desk role and stay permissions"
```

---

### Task 2: Stay services (check-in, reissue, check-out)

**Files:**
- Create: `src/server/admin/stays.ts`
- Create: `src/server/admin/stay-token.ts` (small helper that returns `{ token, hash }`; reuses `generateAccessToken` and `hashAccessToken` from `src/server/tokens.ts`)
- Test: `test/stays.test.ts`

**Interfaces:**
- Consumes: `dbFor`, `checkbox`, `requiredText`, `id`, `isUniqueViolation` from `common.ts`; `audit` from `src/server/audit.ts`; `ActionResult`, `ok`, `fail` from `src/server/forms.ts`.
- Produces:
  - `checkInGuest(actor: Actor, input: Record<string, unknown>): Promise<ActionResult>` where `ActionResult.secret` carries the token (shown once).
  - `reissueGuestToken(actor: Actor, input: Record<string, unknown>): Promise<ActionResult>` where `input.stayId` is a uuid; returns the new token as `secret`.
  - `checkOutGuest(actor: Actor, input: Record<string, unknown>): Promise<ActionResult>`.
  - `listStays(actor: Actor): Promise<StayRow[]>` where `StayRow` has `id, guestDisplayName, status, checkIn, checkOut, tokenRevokedAt, room: { number: string }`.
  - `getStay(actor: Actor, stayId: string)` returning the same shape, or `null`.

Input fields for `checkInGuest`: `roomId` (uuid), `guestDisplayName` (required, max 120), `checkIn` and `checkOut` (ISO date strings, `checkOut > checkIn`).

- [ ] **Step 1: Write failing tests**

```ts
it("checks a guest in and returns a token once", async () => {
  const r = await checkInGuest(frontDeskActor, { roomId, guestDisplayName: "Test Guest", checkIn, checkOut });
  expect(r.ok).toBe(true);
  expect(r.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const row = await adminDb.stay.findFirstOrThrow({ where: { roomId } });
  expect(row.accessTokenHash).toBe(hashAccessToken(r.secret!));
});

it("refuses a second active stay in the same room", async () => {
  await checkInGuest(frontDeskActor, input);
  const r = await checkInGuest(frontDeskActor, input);
  expect(r.ok).toBe(false);
  expect(r.message).toBe("This room already has a guest.");
});

it("reissue revokes the old token", async () => {
  const first = await checkInGuest(frontDeskActor, input);
  const old = await adminDb.stay.findFirstOrThrow({ where: { roomId } });
  const again = await reissueGuestToken(frontDeskActor, { stayId: old.id });
  const after = await adminDb.stay.findFirstOrThrow({ where: { id: old.id } });
  expect(after.accessTokenHash).not.toBe(hashAccessToken(first.secret!));
  expect(after.accessTokenHash).toBe(hashAccessToken(again.secret!));
});

it("check-out sets CHECKED_OUT and revokes the token", async () => {
  // check in, check out, then assert status and tokenRevokedAt set
});

it("an employee cannot check in", async () => {
  await expect(checkInGuest(employeeActor, input)).rejects.toThrow(ForbiddenError);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test test/stays.test.ts`
Expected: FAIL, module `@/server/admin/stays` not found.

- [ ] **Step 3: Implement the three services and two readers**

- Use `dbFor(actor, "stays.manage")` in the three write services and `dbFor(actor, "stays.view")` in the readers.
- Check-in runs in one `tenantDb` transaction: look for an `ACTIVE` stay in the room, create the stay, then write the audit row. Catch the unique violation from the partial index in Step 4.
- Reissue and check-out must refuse stays that are `CHECKED_OUT`, with the message "This stay has ended."
- Each write calls `audit(db, hotelId, { ... })` with the action name, actor and stay id.

- [ ] **Step 4: Add a partial unique index for one active stay per room**

Add to a new migration `prisma/migrations/20261114000100_one_active_stay_per_room/migration.sql`:

```sql
CREATE UNIQUE INDEX stays_one_active_per_room ON stays (room_id) WHERE status = 'ACTIVE';
```

Map `isUniqueViolation` to the message "This room already has a guest." in `checkInGuest`. Relying on the index means two simultaneous check-ins cannot both succeed.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/admin/stays.ts src/server/admin/stay-token.ts prisma test/stays.test.ts
git commit -m "M2: stay check-in, token reissue and check-out services"
```

---

### Task 3: Guest request submission and reading

**Files:**
- Create: `src/server/guest-requests.ts`
- Modify: `src/server/guest.ts` (add `listGuestCategories`, `getGuestItem`)
- Create: `src/server/public-ref.ts`
- Test: `test/guest-requests.test.ts`

**Interfaces:**
- Consumes: `GuestStay` type and `resolveGuestToken` from `guest.ts`; `tenantDb`.
- Produces:
  - `listGuestCategories(guest: GuestStay)` returns active categories with active, non-deleted items, ordered by `sort`.
  - `submitGuestRequest(guest: GuestStay, input: { serviceItemId: string; qty: number; guestNote: string | null }): Promise<ActionResult & { requestId?: string; publicRef?: string }>`.
  - `nextPublicRef(db: TenantDb, departmentId: string, departmentCode: string): Promise<string>` returns `"<CODE>-<number>"`, counter starting at 1001.

`submitGuestRequest` checks, in order, and returns the message shown:
1. The stay is `ACTIVE` and `tokenRevokedAt` is null: otherwise "This link is no longer active."
2. The item exists, is active, not deleted, and belongs to the hotel: otherwise "This service is not available."
3. `qty` is an integer from 1 to `maxQty`: otherwise "Choose a quantity from 1 to {maxQty}."
4. If `needsNote`, the trimmed note is at least 1 character: otherwise "Please describe your request."

On success it writes the `Request` (status `SUBMITTED`, `roomId` and `departmentId` from the item and stay) and a `RequestEvent` (`actorType: GUEST`, `toStatus: SUBMITTED`).

- [ ] **Step 1: Write failing tests**

```ts
it("submits a catalogue request routed to the item's department", async () => {
  const r = await submitGuestRequest(guest, { serviceItemId: towelsItemId, qty: 2, guestNote: null });
  expect(r.ok).toBe(true);
  const row = await adminDb.request.findFirstOrThrow({ where: { id: r.requestId } });
  expect(row.departmentId).toBe(housekeepingId);
  expect(row.status).toBe("SUBMITTED");
});

it("rejects quantity above maxQty without writing", async () => {
  const r = await submitGuestRequest(guest, { serviceItemId: towelsItemId, qty: 99, guestNote: null });
  expect(r.ok).toBe(false);
  expect(await adminDb.request.count({ where: { stayId: guest.stayId } })).toBe(0);
});

it("rejects a concierge request with a blank note", async () => {
  const r = await submitGuestRequest(guest, { serviceItemId: conciergeItemId, qty: 1, guestNote: "   " });
  expect(r.ok).toBe(false);
  expect(r.message).toBe("Please describe your request.");
});

it("refuses submission after check-out", async () => {
  // check out the stay, then submit
  expect((await submitGuestRequest(guest, input)).message).toBe("This link is no longer active.");
});

it("guest cannot read another stay's request", async () => {
  const other = await submitGuestRequest(otherGuest, input);
  expect(await getGuestRequest(guest, other.requestId!)).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test test/guest-requests.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the services**

- Read the stay's `status` and `tokenRevokedAt` inside the same transaction as the write.
- `nextPublicRef` increments a counter stored in the database. Because the Prisma schema has no counter table yet, use `SELECT COUNT(*) + 1000 FROM requests WHERE hotel_id = $1 AND department_id = $2` inside the transaction, and rely on the existing `(hotel_id, public_ref)` unique index plus a single retry on a unique violation.
- `GUEST` must be a new `ActorType` value in `schema.prisma` and in the migration `ALTER TYPE "ActorType" ADD VALUE 'GUEST';`. Add it in this task.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server test prisma
git commit -m "M2: guest request submission and reading"
```

---

### Task 4: Guest pages (EN and AR)

**Files:**
- Create: `src/app/[lang]/g/[token]/layout.tsx` (resolves the token once; `notFound()` if invalid; sets `robots: { index: false }` metadata)
- Create: `src/app/[lang]/g/[token]/page.tsx` (home: categories)
- Create: `src/app/[lang]/g/[token]/[category]/page.tsx` (items)
- Create: `src/app/[lang]/g/[token]/[category]/[item]/page.tsx` (request form)
- Create: `src/app/[lang]/g/[token]/requests/page.tsx` ("My requests")
- Create: `src/app/[lang]/g/[token]/requests/[requestId]/page.tsx` (one request)
- Create: `src/app/[lang]/g/[token]/actions.ts` (`submitRequestAction` wrapping `submitGuestRequest`)
- Modify: `src/i18n/en.ts` and `src/i18n/ar.ts` (guest UI strings under a `guest` key)
- Test: `test/guest-pages.test.ts` (token parsing and resolution only; page rendering is covered by the browser walkthrough in Task 7)

**Interfaces:**
- Consumes: `resolveGuestToken`, `listGuestCategories`, `submitGuestRequest`, `listGuestRequests`, `getGuestRequest`, `getDictionary`, `isLocale`, `dirFor`.
- Produces: `guestTokenFromParams(params: { token: string }): string | null`, which returns `null` for tokens longer than 100 characters or containing characters outside `[A-Za-z0-9_-]`.

Copy (EN / AR): the guest UI strings live in the dictionaries. Arabic strings are my first draft and are flagged for review in the PR.

- [ ] **Step 1: Write failing tests**

```ts
it("rejects tokens that are too long or malformed before any database call", () => {
  expect(guestTokenFromParams({ token: "a".repeat(101) })).toBeNull();
  expect(guestTokenFromParams({ token: "bad token!" })).toBeNull();
  expect(guestTokenFromParams({ token: "iGXmC8p-tboRr0b3eBNDZZlNKoANqhnX2GUdGUFa9fs" })).not.toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test test/guest-pages.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the pages**

- The layout calls `resolveGuestToken`. If it returns `null`, call `notFound()`. Otherwise pass nothing down; each page calls the guest services with the same token.
- Pages are server components. The request form is a client component using `ActionForm`, so the success message appears only after the action returns `ok`.
- After a successful submit, redirect to `requests/<requestId>` and show the public reference.
- Set `dir` from `dirFor(lang)` through the root layout (already in place).

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: PASS; the build lists the new `/[lang]/g/[token]` routes.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "M2: guest pages in English and Arabic"
```

---

### Task 5: Front-desk pages and QR cards

**Files:**
- Create: `src/app/[lang]/staff/front-desk/page.tsx` (check-in form and room picker)
- Create: `src/app/[lang]/staff/front-desk/stays/page.tsx` (stay list)
- Create: `src/app/[lang]/staff/front-desk/stays/[stayId]/card/page.tsx` (printable QR card; shows token once)
- Create: `src/server/guest-links.ts` (builds `<APP_ORIGIN>/en/g/<token>` and `/ar/g/<token>`)
- Modify: `src/app/[lang]/staff/actions.ts` (add `checkInAction`, `reissueTokenAction`, `checkOutAction` via `run()`)
- Modify: `src/app/[lang]/staff/page.tsx` (link to Front desk for roles with `stays.view`)
- Modify: `.env.example` (add `APP_ORIGIN=http://localhost:3000`)
- Test: `test/guest-links.test.ts`

**Interfaces:**
- Consumes: `checkInGuest`, `reissueGuestToken`, `checkOutGuest`, `listStays`, `getStay` from Task 2; `requireStaff({ stage: "signed-in", permission: "stays.manage" })` from `session-cookie.ts`.
- Produces: `guestLinks(token: string): { en: string; ar: string }`, reading `process.env.APP_ORIGIN`. Throws `Error("APP_ORIGIN is not set")` when unset in production (`NODE_ENV === "production"`), otherwise falls back to `http://localhost:3000`.

- [ ] **Step 1: Write failing tests**

```ts
it("builds EN and AR guest links from APP_ORIGIN", () => {
  process.env.APP_ORIGIN = "https://pilot.example";
  expect(guestLinks("abc")).toEqual({ en: "https://pilot.example/en/g/abc", ar: "https://pilot.example/ar/g/abc" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test test/guest-links.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the pages and actions**

- The card page renders the QR SVG from `qrcode.toString(url, { type: "svg" })` for both links, side by side, with the room number and guest name. The token appears only on this page, from the `secret` returned by the reissue or check-in action. It is never stored in a cookie.
- Printing: add `@media print` styles so the card prints without navigation.
- The check-in form submits through `ActionForm`; on `ok`, redirect to the card page with the token passed in a one-time server-side cache (`cache` from `react`), not in the URL.

- [ ] **Step 4: Run tests, typecheck and build**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src test .env.example
git commit -m "M2: front-desk check-in, stay list and QR cards"
```

---

### Task 6: Seed and demo adjustments

**Files:**
- Modify: `prisma/seed.ts`
- Modify: `README.md` (section for guest access and front desk; the "Guest pages arrive in M2" note becomes the guest link instructions)
- Modify: `docs/DECISIONS.md` (add decision 010: front-desk role and token-in-path guest links; decision 011: partial unique index for one active stay per room)

**Interfaces:**
- Consumes: none new.
- Produces: the seed's demo guest token (room 202) continues to work; add one front-desk demo account `frontdesk@demo.hotel` with the same demo password, role `FRONT_DESK`.

- [ ] **Step 1: Write the failing check**

Add to `test/seed.test.ts` (create file if absent): after `seed`, a `FRONT_DESK` membership exists and the room-202 stay resolves through `resolveGuestToken` with the printed token.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test test/seed.test.ts`
Expected: FAIL, no `FRONT_DESK` membership yet.

- [ ] **Step 3: Update the seed and documentation**

- Add the front-desk account to the staff list in `seed.ts` with `role: "FRONT_DESK"` and no department.
- Update README and DECISIONS as listed above.

- [ ] **Step 4: Run tests**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma README.md docs test
git commit -m "M2: demo front-desk account and documentation"
```

---

### Task 7: End-to-end walkthrough and final checks

**Files:**
- Modify: `test/e2e/setup-hotel.e2e.ts` (add a guest and front-desk section after the existing 18 checks)
- Modify: `.github/workflows/ci.yml` (set `APP_ORIGIN` in the job environment to `http://localhost:3010`)

**Interfaces:**
- Consumes: the front-desk and guest pages from Tasks 4 and 5.

- [ ] **Step 1: Add the e2e checks**

Add checks, in this order:
1. Front desk signs in and checks a guest in to a free room; the card page shows two links.
2. Opening the English link shows the category list; the Arabic link renders with `dir="rtl"`.
3. The guest submits a catalogue request; "My requests" lists it with the public reference.
4. The guest submits a concierge request with a note; it appears routed to Concierge.
5. Front desk checks the guest out; the same link now shows "This link is no longer active."

- [ ] **Step 2: Run the full suite**

Run:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pkill -f "next start" ; (pnpm start -p 3010 > /tmp/next-start.log 2>&1 &)
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:3010/en && break; sleep 1; done
BASE_URL=http://localhost:3010 APP_ORIGIN=http://localhost:3010 pnpm test:e2e
pkill -f "next start"
```

Expected: lint, typecheck, tests and build all exit 0; e2e prints all checks passed (18 existing plus the new ones).

- [ ] **Step 3: Commit**

```bash
git add test .github
git commit -m "M2: end-to-end checks for guest access and front desk"
```

---

## Self-review

- **Spec coverage:** front-desk role (Task 1), check-in, reissue and check-out (Task 2), request submission and "My requests" with concierge routing (Task 3), guest pages EN/AR (Task 4), front-desk pages and QR cards (Task 5), seed and docs (Task 6), e2e and CI (Task 7). Staff handling of requests is a non-goal and has no task.
- **Interface consistency:** `ActionResult` with `secret` is used by check-in and reissue; `GuestStay` is used by all guest services; `dbFor` and `Permission` names match M1.
- **Open risk:** the Arabic guest copy is a first draft and needs a fluent reviewer before the pilot. The `ActorType` value `GUEST` is added in Task 3, so its migration must be applied before the tests in that task run.
