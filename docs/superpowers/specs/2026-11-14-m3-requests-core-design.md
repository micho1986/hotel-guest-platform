# M3 Requests Core — Design

**Status:** approved by Michael on 14 Nov 2026 for the two decisions in §4 (polling, local-disk photo adapter). Everything else is the builder's call, marked as such.

**Source:** PRD section 4 (lifecycle), section 5 (permissions), section 7 (M3 "done when": a request goes from guest to completed with a live status on both phones), section 8 (S1, S2, S3, G3, G4, G5).

## 1. Intent

Staff can take a guest request from the department queue to completion on a phone, and the guest sees the status change without reloading. Every transition is recorded as one event, so later KPIs come from the event log, not from counters.

## 2. Goals

- Staff queue per department (employee and supervisor see their own department; GM sees all), with New / Mine / In progress / Done today tabs.
- Request detail for staff: room, item, quantity, guest note, timeline, actions, internal note, one photo.
- State machine from PRD §4, enforced in one place. Illegal transitions are refused (S3).
- Reject needs a reason and returns the request to the queue (S2).
- Guest status page and "My requests" update live; guest can cancel before acceptance (G4); guest rates once after completion (G5).
- One photo per request, uploaded by staff, served only through an authenticated route (T7-compatible).

## 3. Non-goals (later milestones)

- Supervisor assign, reassign, supervisor cancel, SLA timers, escalation, escalation inbox (M4).
- Sound on new request. The queue will highlight new items; the sound is M4 polish, because it needs a user gesture on each device.
- Task transfer between departments, chat with the guest.
- Staff rostering, auto-assignment.

## 4. Decisions

**D1. Live updates by polling (approved).** The staff queue, request detail and guest status pages refresh every 5 seconds while visible, by calling `router.refresh()` from a small client component. Pages stay server-rendered; no new API. Polling pauses when the tab is hidden. Cost: up to a 5-second delay, and some extra reads. Revisit with server-sent events if the pilot needs faster updates.

**D2. Photos on local disk behind an adapter (approved).** A `PhotoStore` interface with two methods, `put(key, bytes)` and `get(key)`. The M3 implementation writes to `UPLOAD_DIR` (default `.uploads/`, git-ignored). Photos are only read through a route handler that checks the staff session and department. Swapping to S3 or Supabase Storage later means one new class.

**D3. Photo validation (builder's call, marked).** Accept JPEG, PNG and WebP only, detected from the file's leading bytes, not the extension. Maximum 5 MB. Re-encode with `sharp` (new dependency, added in this milestone) so metadata such as GPS is stripped, as the PRD requires. Refuse the upload if re-encoding fails.

**D4. Transition writes are conditional (builder's call, marked).** Each transition is `updateMany where id AND status = <from>`, then one `RequestEvent` insert, in one transaction. If the count is not 1, the transition is refused with "This request has already changed." This is what makes two staff pressing Accept at once safe.

**D5. Routing and the first two events (builder's call, marked).** `submitGuestRequest` already writes SUBMITTED. In the same transaction it now also moves the request to RECEIVED with a SYSTEM event, which is PRD §4 "Submitted → Received (System)". Department queues show RECEIVED and later states.

**D6. Rating (builder's call, marked).** Stored in the existing `RequestFeedback` table (one per request, rating 1–5, optional comment). Allowed only when the request is COMPLETED and no feedback exists. Refused otherwise with a plain message.

**D7. Notifications (builder's call, marked).** A reject writes one `Notification` row for each active supervisor in the department. The queue shows the unread count. No email, SMS or push.

## 5. State machine

| From | To | Who | Rule |
|---|---|---|---|
| — | SUBMITTED | Guest | Created by `submitGuestRequest` (exists) |
| SUBMITTED | RECEIVED | System | Same transaction as submit (D5) |
| RECEIVED | ACCEPTED | Employee or supervisor, own dept | Sets `assigneeId`, `acceptedAt` |
| RECEIVED | RECEIVED (rejected) | Employee, own dept | Reason required; notifies supervisors (D7) |
| ACCEPTED | IN_PROGRESS | Assignee | Sets `startedAt` |
| IN_PROGRESS | WAITING_FOR_GUEST | Assignee | Note required |
| WAITING_FOR_GUEST | IN_PROGRESS | Assignee | — |
| IN_PROGRESS | COMPLETED | Assignee | Sets `completedAt`; optional photo |
| SUBMITTED or RECEIVED | CANCELLED | Guest | Only before acceptance (G4) |

Any other pair is refused. Escalation is not a status (M4).

## 6. Permissions

- Queue and detail: employee and supervisor see requests whose `departmentId` matches one of their memberships; GM sees all. Hotel admin sees no requests (PRD matrix).
- Room number is shown; guest name is never shown to staff (T6). `guestDisplayName` is not selected in staff queries.
- Accept, start, wait, resume, complete, reject: assignee or same-department member; checked in the service, not the page.
- Photo read: same rule as the request it belongs to.
- Every staff action checks the actor's department in the service with `assertCan` plus a department check.

## 7. Test plan

- State machine: every legal pair succeeds and writes one event; every illegal pair is refused and writes nothing (S3).
- Reject without reason is refused; with reason it returns to RECEIVED and creates supervisor notifications (S2).
- Two concurrent accepts: exactly one succeeds (D4).
- Queue scope: a housekeeping employee cannot read an engineering request by id (S1, T1-style).
- Employee-facing data contains no guest name (T6).
- Guest cancel allowed before acceptance, refused after (G4).
- Rating: allowed once after completion, refused on second attempt and before completion (G5).
- Photo: wrong magic bytes refused; over 5 MB refused; valid image re-encoded with no EXIF; read refused to another department.
- E2e: guest submits, staff accepts, starts, completes, guest sees Completed and rates (M3 done-when).

## 8. Open items

- Arabic copy for staff screens: none needed (staff UI is English for the pilot).
- Sound on new request: M4.
- Hotel timezone for "Done today": uses Asia/Dubai, as in M2 (known gap).
