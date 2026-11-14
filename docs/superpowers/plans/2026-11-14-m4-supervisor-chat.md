# M4 Supervisor routing, alerts, transfer and staff chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supervisors are alerted when a guest request is still unaccepted after its window; supervisors assign, reassign and cancel; any staff member can transfer a request to another department; departments chat live.

**Architecture:** Alert windows are a pure function; a scheduled job applies them and writes alerts idempotently. Assign, reassign, cancel and transfer go through the M3 transition service, one event per change. Chat is two tables read and written through tenant-scoped transactions, polled every 5 seconds. Web push is a subscription table plus a sender behind an interface.

**Tech Stack:** As M3, plus `web-push` (sender only; tests use a stub).

**Spec:** docs/superpowers/specs/2026-11-14-m4-supervisor-chat-design.md

## Global Constraints

- Urgent window 5 minutes; normal window 10 minutes; clock starts when the request enters RECEIVED (`createdAt` or `alertedAt` when set).
- Guest names are never shown to staff, in queues, alerts or chat.
- Every new table carries `hotelId` and `isDemo`; RLS applies.
- Chat polling interval 5 seconds, as the M3 queue.

## Review Focus

1. Alert job run twice in one window sends one alert per supervisor per request.
2. A supervisor of another department tries to assign: refused.
3. Transfer of a COMPLETED request: refused.
4. Chat post by someone who has left the department (membership removed): refused.
5. A request with no supervisor in its department alerts the hotel admins, not nobody.

---

### Task 1: Alert windows (pure)

**Files:** Create `src/server/requests/alerts.ts`; Test `test/alert-windows.test.ts`.

**Interfaces:** Produces `alertWindowMs(priority: "NORMAL" | "URGENT"): number` (300_000 / 600_000) and `isAlertDue(input: {priority, status, createdAt, alertedAt}, now: Date): boolean` (true only when status is RECEIVED and now − (alertedAt ?? createdAt) ≥ window).

- [ ] **Step 1: Write failing tests** for: normal request not due at 9 min 59 s, due at 10 min; urgent due at 5 min; a request with `alertedAt` 4 min ago is not due for urgent; a non-RECEIVED request is never due.
- [ ] **Step 2: Run** `pnpm vitest run test/alert-windows.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the two functions.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit.** `M4: alert windows by priority`

### Task 2: Alert job (idempotent, falls back to hotel admins)

**Files:** Create `src/server/requests/alert-job.ts`; Create `src/app/api/jobs/alerts/route.ts`; Test `test/alert-job.test.ts`.

**Interfaces:** Consumes `isAlertDue` (Task 1). Produces `runAlertJob(now: Date): Promise<{alerted: number}>`; the route is `GET /api/jobs/alerts` requiring `Authorization: Bearer ${ALERT_JOB_SECRET}`.

- [ ] **Step 1: Write failing tests**: a due request alerts the department's supervisors and sets `alertedAt`; running twice in the same window alerts once; with no supervisor in the department, alerts the hotel's HOTEL_ADMIN staff instead; a request under its window alerts nobody.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `runAlertJob`: select due RECEIVED requests across hotels, for each: recipients = supervisors of the department, else hotel admins; write `Notification` rows (type `REQUEST_ALERT`, requestId); set `alertedAt = now` with a conditional update where `alertedAt` is unchanged, so a second run cannot double-alert.
- [ ] **Step 4: Implement the route** with the bearer check; 401 without it.
- [ ] **Step 5: Run** tests. Expected: PASS.
- [ ] **Step 6: Commit.** `M4: alert job with idempotent windows and admin fallback`

### Task 3: Supervisor assign, reassign and cancel

**Files:** Create `src/server/requests/supervisor.ts`; Test `test/supervisor-actions.test.ts`.

**Interfaces:** Consumes `applyTransition`, `viewScope`/`departmentIds` (M3). Produces `assignRequest(actor, requestId, staffId)`, `reassignRequest(actor, requestId, staffId)`, `cancelStaffRequest(actor, requestId, reason)`.

- [ ] **Step 1: Write failing tests**: assign sets `assigneeId` and writes one event; reassign moves to another member of the same department; cancel from New or Accepted only, with a reason; a supervisor of another department is refused (Review Focus 2); a staff member who is not a supervisor is refused; the assignee must belong to the request's department.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Assign and reassign are a `RECEIVED` or `ACCEPTED` change with a note naming the staff member; cancel uses `applyTransition` to `CANCELLED`, internal note = reason.
- [ ] **Step 4: Run** tests. Expected: PASS.
- [ ] **Step 5: Commit.** `M4: supervisor assign, reassign and cancel`

### Task 4: Transfer to another department

**Files:** Create `src/server/requests/transfer.ts`; Test `test/transfer.test.ts`.

**Interfaces:** Produces `transferRequest(actor, requestId, toDepartmentId, reason)`; consumes `applyTransition`.

- [ ] **Step 1: Write failing tests**: transfer of an ACCEPTED request moves `departmentId`, clears `assigneeId`, sets `transferredAt`, writes one event with both departments in the note; transfer of a COMPLETED request is refused (Review Focus 3); a blank reason is refused; the receiving department's supervisors get an alert row.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** using `applyTransition` with `patch` for `departmentId`, `assigneeId: null`, `transferredAt`; then the notification write.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `M4: transfer a request to another department`

### Task 5: Chat channels and messages

**Files:** Modify `prisma/schema.prisma` (models `ChatChannel`, `ChatMessage`); Create `prisma/migrations/<timestamp>_m4_chat/migration.sql` (hand-written, with RLS policies in the same style as earlier migrations); Create `src/server/chat.ts`; Test `test/chat.test.ts`.

**Interfaces:** Produces `postChatMessage(actor, channelId, body)`, `listChatMessages(actor, channelId, sinceId?)`. Channel created per department when the department is created.

- [ ] **Step 1: Write failing tests**: a member posts and reads; a non-member is refused for read and for post; a message with a blank body is refused; a removed member's post is refused (Review Focus 4); a supervisor reads every channel in their hotel; no message from another hotel is ever returned.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Add the models and migration**, then run the migration against the test database (the global setup rebuilds from migrations).
- [ ] **Step 4: Implement** the two functions with `tenantTransaction`; membership check against `StaffMembership`.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit.** `M4: department chat channels and messages`

### Task 6: Push subscriptions and sender

**Files:** Modify `prisma/schema.prisma` (`PushSubscription`); migration; Create `src/server/push.ts` (`PushSender` interface, `webPushSender`); Test `test/push.test.ts`.

**Interfaces:** Produces `saveSubscription(actor, subscription)`, `sendAlertPush(staffId, payload)`; the sender is injected so tests use a stub.

- [ ] **Step 1: Write failing tests**: a subscription is saved per device, and a second save of the same endpoint is idempotent; a push is sent to every device of a recipient; a device returning 410 is deleted.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Add the `web-push` dependency and the model and migration; implement** the functions.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `M4: web push subscriptions and sender`

### Task 7: Staff screens

**Files:** Modify `src/app/[lang]/staff/requests/[requestId]/page.tsx` and `actions.ts` (assign, reassign, cancel, transfer forms, shown by permission); Create `src/app/[lang]/staff/requests/[requestId]/...` none; Create `src/app/[lang]/staff/chat/page.tsx` (channel list, messages, post form, `AutoRefresh` 5 seconds); Create `public/sw.js` and `src/components/alert-sound.tsx` (plays sound on the queue when the alert count rises; asks push permission once).

- [ ] **Step 1: Confirm the tests from Tasks 3–6 are green** (they are the failing checks for these screens).
- [ ] **Step 2: Implement** the screens with the existing `ActionForm`, `card`, `th`, `td` classes.
- [ ] **Step 3: Run** `pnpm lint && pnpm typecheck && pnpm build`. Expected: exit 0; the new routes are listed.
- [ ] **Step 4: Commit.** `M4: supervisor, transfer and chat screens; alert sound and push permission`

### Task 8: Scheduler

**Files:** Modify `README.md` (how to call `/api/jobs/alerts` every minute, with `ALERT_JOB_SECRET`); `.env.example` (add `ALERT_JOB_SECRET`).

- [ ] **Step 1: Document** the external scheduler call and the secret. Hosting for the scheduler is an open question (see below); the route works from any scheduler that can send a bearer header.
- [ ] **Step 2: Commit.** `M4: document the alert job schedule`

### Task 9: End-to-end checks

**Files:** Modify `test/e2e/setup-hotel.e2e.ts`; append M4 checks after the M3 block.

- [ ] **Step 1: Add checks**: a new urgent request reaches the supervisor's alert list after 5 minutes; the supervisor reassigns; staff transfers to another department and it appears there as New; a chat message from one department appears for a member of the same department within 10 seconds.
- [ ] **Step 2: Run** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, then the e2e per the M2 command with `APP_ORIGIN`. Expected: all checks pass.
- [ ] **Step 3: Commit.** `M4: end-to-end checks for supervisors, transfer and chat`

---

## Open questions for the approver

1. **Scheduler hosting:** what runs `/api/jobs/alerts` every minute? Options: an external cron service, or the hosting platform's scheduler. Until chosen, the alert job is only exercised by tests and manual calls.
2. **`web-push` dependency:** adding it requires your approval.
