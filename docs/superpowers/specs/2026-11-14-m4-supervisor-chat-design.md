# M4: supervisor routing, alerts, transfer and staff chat — design

Status: draft for approval (2026-11-14). All questions resolved; awaiting approval. Builds on M3 (`m3-requests-core`).

## Intent

Supervisors see new guest requests first and keep the queues moving. Staff keep working as they do today, and can also talk to each other while they work.

## Goals

1. A new request alerts the department's supervisor immediately.
2. If a request is still in New after **5 minutes** (urgent) or **10 minutes** (normal), the supervisor is alerted again. It is never escalated automatically; it stays in New until someone acts.
3. Supervisors can assign, reassign and cancel requests in their department.
4. Any staff member can transfer a request to another department.
5. Staff can chat live in department channels.

## Non-goals

- Automatic reassignment or escalation to the GM.
- Alerts when the screen is closed by phone push beyond the web push below (no SMS, no Telegram).
- Direct messages between individuals. Channels only.
- Guest-visible reasons for reassignment or transfer.
- A supervisor-first rule that blocks staff. Staff keep the M3 right to accept directly (see Decision 1).

## Decisions (from the planning conversation)

1. **Any department member can accept.** During the window and after it, any staff member in the department can accept a New request, as in M3. The supervisor is alerted first and may reassign it; the supervisor is not a gate. The window only controls when the supervisor is alerted again.
2. **Alert timing.** 5 minutes for urgent requests, 10 minutes for normal. Clock starts when the request enters New. The alert fires once per request per window while it is still New.
3. **Alert channels.** A sound on the open queue screen, plus a web push notification from the staff site (permission asked once on the supervisor's device). No SMS, no Telegram.
4. **Reassignment is manual.** The supervisor picks the staff member; there is no automatic assignment.
5. **Transfer.** Any staff member can move a request to another department. The request becomes New in the receiving department, keeps its history, and the receiving supervisor is alerted.
6. **Chat.** Live, channels by department. Every staff member can join their own department's channel; GM and supervisors can read every channel. No direct messages.

## Approaches considered

- **A. Poll-based alerts only.** Reuses M3 polling; no sound timing guarantees, no push. Rejected: a supervisor on another screen would miss the alert window.
- **B. Web push + sound on the open queue (chosen).** Works on phones and desktops that allow notifications; sound covers the open screen.
- **C. Server-sent events for chat and alerts.** Lower latency, but a second live channel to build and secure next to polling. Chat needs live delivery, so chat uses SSE or polling (see Open questions).

## Model changes

- `Request.assigneeId` already exists. Add `Request.alertedAt` (timestamp of the last supervisor alert) and `Request.transferredAt` (nullable).
- `RequestEvent` gains `actorType` values already present; transfer and reassign are events with `fromStatus = toStatus` and a note, so the timeline stays one event per change.
- New `ChatChannel` (hotelId, departmentId, unique per department) and `ChatMessage` (hotelId, channelId, authorStaffId, body, createdAt). Every row carries `hotelId`; RLS applies as on other tables.
- New `PushSubscription` (hotelId, staffUserId, endpoint, keys, createdAt), one row per device.
- All new tables carry `isDemo` as the existing tables do.

## Behaviour

- **No supervisor on shift.** If the department has no supervisor, the alert goes to the hotel admins instead, using the same window.
- **Alert job.** A scheduled check (every 15 seconds) finds requests in RECEIVED whose `createdAt` or `alertedAt` is older than their window (5 minutes if URGENT, 10 minutes otherwise), alerts the department's supervisors, and sets `alertedAt`. Idempotent: running it twice in the same window sends one alert.
- **Assign / reassign / cancel.** Supervisor only, for their department. Each is one `applyTransition`-style change with one event; cancel is allowed from New or Accepted.
- **Transfer.** Staff in any department may transfer a New or Accepted request. Accepted transfers clear `assigneeId`. One event with a note naming both departments.
- **Chat.** Messages are stored, then pushed to open clients. Channels are created when a department is created. Read permission: department members, supervisors, GM. Write permission: department members.
- **Privacy.** Chat and alerts never include guest names; they show the request reference and room number, as M3 does.

## Permissions

- `requests.assign`: SUPERVISOR for their department; GM read-only.
- `requests.transfer`: any staff with `requests.manage`.
- `chat.post`: department members with `requests.manage`.
- `chat.read`: members of the channel's department, supervisors, GM.

## Open questions

1. **Supervisor-first when none is on shift.** If the department has no supervisor on duty, the alert goes to the hotel admin, at the same window for the request's priority. Resolved by your answer on 2026-11-14.
2. **Chat transport.** Resolved: polling every 5 seconds, as in M3, so there is one live mechanism.
3. **Push on iOS.** Resolved: accepted. Web push on iOS works only for sites added to the home screen; supervisors on iPhone otherwise get the sound alert while the queue is open.

## Review focus

1. Two supervisors reassign the same request at once: exactly one succeeds.
2. A supervisor from another department tries to assign: refused.
3. Transfer of a Completed request: refused.
4. Alert job run twice in one window: one alert.
5. Chat message from a staff member who left the department: refused.
