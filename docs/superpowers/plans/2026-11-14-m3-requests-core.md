# M3 Requests Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native, one session) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A request goes from guest to completed through the staff queue, with a live status on the guest's phone and a one-time rating at the end.

**Architecture:** One transition service enforces the PRD state machine: each change is a conditional `updateMany` plus one `RequestEvent`, in one transaction. Staff and guest pages poll with `router.refresh()` every five seconds. Photos go through a `PhotoStore` adapter (local disk now) and are served only by an authenticated route.

**Tech Stack:** as M2, plus `sharp` for photo re-encoding.

**Spec:** `docs/superpowers/specs/2026-11-14-m3-requests-core-design.md`

## Global Constraints

- Every tenant query goes through `tenantDb(hotelId)` or `dbFor(actor, permission)`; no raw `appDb()` in these paths.
- Every status change is one `RequestEvent` in the same transaction as the change (PRD §4).
- No success message before the database write returns.
- Employee-facing data never includes `guestDisplayName` (T6).
- Photo bytes are never served from a public URL.
- Demo data only (`isDemo`).
- Migrations are hand-written SQL, one folder per change. This milestone adds none: the schema already has the needed tables and enums.

## Review Focus

1. **Two staff accept the same request at once.** Expected: exactly one succeeds; the other sees "This request has already changed." Test in Task 2.
2. **Photo whose extension says PNG but whose bytes are a script.** Expected: refused by magic-byte check, nothing stored. Test in Task 6.
3. **Reject with a whitespace-only reason.** Expected: refused, no event written. Test in Task 4.
4. **Guest rates a request that is still in progress, then rates it twice.** Expected: both refused. Test in Task 5.
5. **Photo path key containing `..` or a slash built from request input.** Expected: refused before any filesystem call. Test in Task 1.

---

### Task 1: Photo store adapter

**Files:**
- Create: `src/server/photos/store.ts` (interface and `localPhotoStore`)
- Create: `test/photo-store.test.ts`
- Modify: `package.json` (add `sharp`), `.gitignore` (add `.uploads/`)

**Interfaces:**
- Produces: `interface PhotoStore { put(key: string, bytes: Buffer): Promise<void>; get(key: string): Promise<Buffer | null> }`; `photoStore: PhotoStore` (local disk at `process.env.UPLOAD_DIR ?? ".uploads"`); `safeKey(key: string): string` (throws on `..`, `/`, `\`, or anything outside `[A-Za-z0-9_-.]{1,120}`).

- [ ] **Step 1: Write the failing tests**

```ts
it("round-trips bytes", async () => { await store.put("k1", Buffer.from("x")); expect((await store.get("k1"))!.toString()).toBe("x"); });
it("returns null for a missing key", async () => { expect(await store.get("nope")).toBeNull(); });
it("refuses keys with path parts", () => { expect(() => safeKey("../etc")).toThrow(); expect(() => safeKey("a/b")).toThrow(); });
```

- [ ] **Step 2: Run to verify it fails.** `npx vitest run test/photo-store.test.ts` → FAIL, module not found.
- [ ] **Step 3: Implement** `store.ts` with `fs/promises` writes under the upload dir, `mkdir recursive`, and `safeKey` applied on every put and get.
- [ ] **Step 4: Run to verify it passes.** Expected: 3 passed.
- [ ] **Step 5: Install sharp and ignore uploads.** `pnpm add sharp`; add `.uploads/` to `.gitignore`. Run `pnpm typecheck`. Expected: exit 0.
- [ ] **Step 6: Commit.** `git add -A src/server/photos test/photo-store.test.ts package.json pnpm-lock.yaml .gitignore && git commit -m "M3: photo store adapter"`

---

### Task 2: Transition service

**Files:**
- Create: `src/server/requests/transitions.ts`
- Create: `test/transitions.test.ts`

**Interfaces:**
- Consumes: `RequestStatus`, `ActorType` from the Prisma client; `tenantDb`.
- Produces: `TRANSITIONS: Record<RequestStatus, RequestStatus[]>` (the PRD §5 table, excluding the escalation flag); `applyTransition(db, { requestId, from: RequestStatus[], to, actor: {type, id?}, note?, isInternal?, patch? })` returning `{ ok: true } | { ok: false; message }`. It runs inside a transaction: `updateMany where id AND status in from`, then `requestEvent.create`. When the count is not 1, it returns "This request has already changed." and writes no event.

- [ ] **Step 1: Write the failing tests.** One table-driven test over all 7×7 pairs: legal pairs return ok and write exactly one event with `fromStatus`/`toStatus` set; illegal pairs return not-ok and write zero events. A concurrency test: two `applyTransition` calls from RECEIVED→ACCEPTED run with `Promise.all`; exactly one is ok, and exactly one ACCEPTED event exists.
- [ ] **Step 2: Run to verify it fails.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `TRANSITIONS` as written in the spec §5 and `applyTransition` with `db.$transaction`. Use `updateMany` and check `count`.
- [ ] **Step 4: Run to verify it passes.** Expected: all green, including the concurrency test.
- [ ] **Step 5: Commit.** `M3: transition service with one event per change`

---

### Task 3: Routing to Received on submit

**Files:**
- Modify: `src/server/guest-requests.ts`
- Modify: `test/guest-requests.test.ts`

**Interfaces:**
- Consumes: `applyTransition` from Task 2.

- [ ] **Step 1: Write the failing test.** After `submitGuestRequest`, the request's status is `RECEIVED`, and it has exactly two events: SUBMITTED (GUEST) and RECEIVED (SYSTEM), in that order.
- [ ] **Step 2: Run to verify it fails.** Expected: FAIL, status is SUBMITTED.
- [ ] **Step 3: Implement.** Inside the existing submit transaction, after the first event, call `applyTransition` with `from: ["SUBMITTED"]`, `to: "RECEIVED"`, actor `SYSTEM`.
- [ ] **Step 4: Run to verify it passes**, plus the existing M2 request tests (6 tests).
- [ ] **Step 5: Commit.** `M3: route submitted requests to Received`

---

### Task 4: Staff services — queue, detail, and actions

**Files:**
- Create: `src/server/requests/staff.ts`
- Create: `test/staff-requests.test.ts`
- Modify: `src/server/auth/permissions.ts` (add `requests.view` for EMPLOYEE, SUPERVISOR, GM; `requests.manage` for EMPLOYEE, SUPERVISOR)

**Interfaces:**
- Consumes: `applyTransition`, `dbFor`.
- Produces: `listQueue(actor, { tab: "new" | "mine" | "in_progress" | "done_today" })` (department scope from memberships; GM sees all; selects room number and item name, never guest name); `getRequestForStaff(actor, id)` (same scope; returns events with `isInternal` filtered for employees only where stated); `acceptRequest(actor, id)`, `rejectRequest(actor, id, reason)`, `startRequest(actor, id)`, `waitForGuest(actor, id, note)`, `resumeRequest(actor, id)`, `completeRequest(actor, id)`, `addInternalNote(actor, id, note)`. Every action calls `assertCan(actor, "requests.manage")` and checks the request's department is among the actor's memberships (GM may not act, only view).

- [ ] **Step 1: Write the failing tests.**
  - Housekeeping employee lists only housekeeping requests; GM lists both (S1 scope).
  - Employee's detail payload has no `guestDisplayName` key (T6).
  - Reject with `"   "` returns not-ok and writes no event (Review Focus 3).
  - Engineering employee calling `acceptRequest` on a housekeeping request gets a forbidden message and no event.
  - Accept by a housekeeping employee sets `assigneeId` and `acceptedAt`; a second accept returns "This request has already changed."
  - Reject with a reason returns to RECEIVED, writes a REJECTED-reason event with the note, and creates one notification per active supervisor in the department.
- [ ] **Step 2: Run to verify it fails.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the services with the rules from spec §5 and §6. Notifications: `db.notification.createMany` with `type: "REQUEST_REJECTED"`, one row per supervisor membership in the department.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit.** `M3: staff queue, detail and request actions`

---

### Task 5: Guest cancel and rating

**Files:**
- Modify: `src/server/guest-requests.ts` (add `cancelGuestRequest`, `rateGuestRequest`)
- Create: `test/guest-feedback.test.ts`

**Interfaces:**
- Produces: `cancelGuestRequest(guest, requestId)` (allowed from SUBMITTED or RECEIVED only; uses `applyTransition` with GUEST actor); `rateGuestRequest(guest, requestId, { rating: 1..5, comment?: string })` (request must be COMPLETED for this stay; one `RequestFeedback` per request, refused on duplicate).

- [ ] **Step 1: Write the failing tests.**
  - Cancel from RECEIVED succeeds; cancel from ACCEPTED is refused (G4).
  - Rating an IN_PROGRESS request is refused; rating a COMPLETED one succeeds once; a second rating is refused (Review Focus 4, G5).
  - A guest of another stay cannot cancel or rate the request (T3).
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5: Commit.** `M3: guest cancel and one-time rating`

---

### Task 6: Photo upload and authenticated read

**Files:**
- Create: `src/server/requests/photos.ts` (`uploadRequestPhoto`, `readRequestPhoto`, `detectImageType`)
- Create: `test/request-photos.test.ts`

**Interfaces:**
- Consumes: `photoStore` (Task 1), `sharp`, `getRequestForStaff` scope rule.
- Produces: `detectImageType(bytes): "jpeg" | "png" | "webp" | null` (magic bytes: `FF D8 FF`, `89 50 4E 47`, `RIFF....WEBP`); `uploadRequestPhoto(actor, requestId, bytes)` (≤ 5 MB; detects type; re-encodes with `sharp().rotate().toFormat(type)` to strip metadata; stores under key `<requestId>.<ext>`; writes a `RequestPhoto` row; at most one photo per request, refusing a second); `readRequestPhoto(actor, requestId)` (same department scope).

- [ ] **Step 1: Write the failing tests.**
  - A file starting with `<script>` renamed `.png` is refused and nothing is stored (Review Focus 2).
  - A 5 MB + 1 byte buffer is refused.
  - A real small PNG generated with sharp is accepted; the stored bytes have no EXIF (`sharp(stored).metadata().exif` is undefined).
  - A second upload for the same request is refused.
  - Reading a photo as a housekeeping employee for an engineering request is refused.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5: Commit.** `M3: request photos with type check and re-encode`

---

### Task 7: Staff screens and polling

**Files:**
- Create: `src/components/auto-refresh.tsx` (client; `setInterval(router.refresh, 5000)` while `document.visibilityState === "visible"`)
- Create: `src/app/[lang]/staff/requests/page.tsx` (queue with tabs; uses `listQueue`)
- Create: `src/app/[lang]/staff/requests/[requestId]/page.tsx` (detail: room, item, qty, note, timeline, actions, internal note, photo)
- Create: `src/app/[lang]/staff/requests/[requestId]/actions.ts` (server actions wrapping Task 4 and Task 6 services, same `run` pattern as `staff/actions.ts`)
- Create: `src/app/[lang]/staff/requests/[requestId]/photo/route.ts` (GET; `readRequestPhoto` then `new Response(bytes, { headers: { "Content-Type": ..., "Cache-Control": "private, no-store" } })`)
- Modify: `src/app/[lang]/staff/page.tsx` (replace "Request queue… from milestone M3" card with a link when `can(actor, "requests.view")`)

**Interfaces:**
- Consumes: Tasks 4 and 6.

- [ ] **Step 1: Write the e2e check first** (added in Task 9). For this task, the test is the service tests from Tasks 4 and 6 plus a build: `pnpm build` must succeed with the new routes.
- [ ] **Step 2:** `pnpm typecheck` fails until the pages exist — confirm.
- [ ] **Step 3: Implement** the pages with the existing `ActionForm`, `card`, `th`, `td` classes. Reject form requires a reason field; the button is the only way to reject.
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm build`. Expected: exit 0; routes `/staff/requests`, `/staff/requests/[requestId]`, `/staff/requests/[requestId]/photo` listed.
- [ ] **Step 5: Commit.** `M3: staff request queue and detail screens`

---

### Task 8: Guest live status

**Files:**
- Modify: `src/app/[lang]/g/[token]/requests/[requestId]/page.tsx` (show status timeline, cancel button while allowed, rating form when COMPLETED and unrated; include `<AutoRefresh />` while status is not COMPLETED or CANCELLED)
- Modify: `src/app/[lang]/g/[token]/requests/[requestId]/actions.ts` (create if absent: `cancelAction`, `rateAction`)
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts` (add `guest.cancel`, `guest.rate`, `guest.rateThanks`, `guest.rateOnce`, `guest.liveNote`)

- [ ] **Step 1–2:** the e2e check from Task 9 is the failing test; confirm the page does not yet show the cancel button.
- [ ] **Step 3: Implement.** Arabic strings are first-draft and marked in the commit message as needing review.
- [ ] **Step 4:** `pnpm build` passes.
- [ ] **Step 5: Commit.** `M3: guest live status, cancel and rating`

---

### Task 9: End-to-end walkthrough and final checks

**Files:**
- Modify: `test/e2e/setup-hotel.e2e.ts` (add M3 checks after the existing 25)

- [ ] **Step 1: Add the checks**, in order:
  1. Guest submits "Extra towels"; the request appears in the Housekeeping queue as Received, and not in Engineering's.
  2. Staff rejects with no reason → refused; with a reason → back in the queue.
  3. Staff accepts, starts, waits for guest with a note, resumes, completes.
  4. Guest sees Completed without reloading (the page updates within 10 seconds).
  5. Guest rates 4 stars; a second rating is refused.
  6. Staff uploads a small PNG; reopening the detail shows it.
- [ ] **Step 2: Run the full suite:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, then the e2e per the M2 command with APP_ORIGIN. Expected: everything exits 0; e2e prints all checks passed (25 + 6).
- [ ] **Step 3: Commit.** `M3: end-to-end checks for requests core`

---

## Self-review

- **Spec coverage:** queue and scope (Task 4, 7), detail (Task 7), state machine (Task 2), reject reason (Task 4), notifications (Task 4), guest cancel (Task 5), rating (Task 5), photos (Task 1, 6), polling (Task 7, 8), routing to Received (Task 3), e2e (Task 9). Supervisor-only actions and SLA are M4 (spec §3).
- **Interface consistency:** `applyTransition` (Task 2) is consumed by Tasks 3, 4, 5; `PhotoStore` (Task 1) by Task 6; `getRequestForStaff` scope rule (Task 4) reused by Task 6.
- **Open risk:** Arabic copy for the guest additions needs a fluent reviewer, as in M2.
