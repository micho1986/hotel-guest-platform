# M2 design: guest access, check-in and service requests

Status: draft for approval · 14 Nov 2026

## Intent

A guest scans a QR code in their room and can request a service in English or Arabic, then see what happens to it.
Front desk checks guests in, prints each room's QR card, and checks guests out, which ends their access.
Each request reaches the right department straight away, because the item they pick already names its department.

## Goals

- Guest opens `/en/g/<token>` (or `/ar/g/<token>`) from the QR code, with no sign-in.
- Guest browses categories and items, submits a request with quantity and an optional note, and sees "My requests" with status.
- Anything not in the catalogue goes through a Concierge request, written in the guest's own words, which routes to Concierge.
- Front desk checks a guest in to a room, prints the room's QR card, and checks the guest out.
- Check-out and token reissue revoke access immediately.
- A guest can see only their own stay's requests, enforced in tests.

## Non-goals (M2)

- Staff handling of requests (accepting, progressing, completing). Requests stay `SUBMITTED` until that work lands. Demo data can show other statuses.
- Guest accounts, passwords, or email/phone sign-in.
- Push notifications, photos, feedback, and in-room dining ordering (post-MVP).
- Payments.

## Constraints

- Every guest and staff query goes through `tenantDb(hotelId)`, with row-level security on the runtime role (decision 002).
- Guest tokens resolve only through `resolve_guest_stay` (decision 003). Only the SHA-256 hash is stored.
- Services check permissions and validate input. Server actions only pass form values through (decision 008).
- Request history is append-only (decision 005). Every status change writes a `request_events` row.
- Pages live under `/en` and `/ar` (decision 004).
- No fake success messages. A confirmation appears only after the database write succeeds.
- Fictional demo data only. No real guest or staff data before management approval.

## Roles

A new hotel-wide role, `FRONT_DESK`, is added alongside Employee, Supervisor, GM and Hotel Admin.

- Front desk is hotel-wide, so it carries no department (like GM and Hotel Admin).
- Front desk does not require MFA. Only GM and Hotel Admin do, as today.
- Permission `stays.manage` (check in, print cards, check out, reissue tokens) is granted to FRONT_DESK, SUPERVISOR, GM and HOTEL_ADMIN.
- Permission `stays.view` (the stay list) is granted to the same four roles.
- Supervisor is included as approved in the earlier default. Supervisors see stays hotel-wide, not only their department.

## Approaches considered

**Guest link format**
- **A (chosen): token in the path**, `/en/g/<token>`. Works with a printed QR code and needs no extra state. Trade-off: the token shows in the address bar and history. Mitigation: no third-party scripts on guest pages, `noindex`, and revocation at check-out or reissue.
- B: exchange the token once for a session cookie, then redirect. Hides the token, but adds a cookie, a second step, and more to test. Not worth it for MVP.

**What guests can request**
- **A (chosen): catalogue plus one free-text item.** Guests pick from the catalogue as before, and those requests route automatically from the item's rule. A "Concierge request" item takes free text in the note, which is required, and routes to Concierge. Only free text reaches a person at the desk first.
- B: catalogue only. Anything outside the list can't be asked for.

## Decisions

1. **Schema:** add `FRONT_DESK` to `StaffRole`. The migration is hand-written with `ALTER TYPE "StaffRole" ADD VALUE 'FRONT_DESK'`, as in decision 006. Run `prisma migrate dev` on the Mac to confirm no drift.
2. **Check-in:** a service `checkInGuest` creates a `Stay` (room, guest display name, check-in and check-out dates, status `ACTIVE`). It generates a 32-byte token, stores its hash, and returns the token once for the card. Check-in refuses a room that already has an active stay.
3. **QR card:** a print page encodes `<APP_ORIGIN>/en/g/<token>` (and the Arabic link) with the existing `qrcode` package. The token is shown only on the card page. Reprinting a lost card means reissuing the token, which revokes the old one.
4. **Reissue and check-out:** reissue rotates the token hash and sets `tokenRevokedAt` on the old one. Check-out sets status `CHECKED_OUT` and revokes the token. Both write audit entries.
5. **Request reference:** `publicRef` uses the department code and a per-department counter (for example `HK-1042`). The counter increments inside the transaction. A unique-violation retry covers races.
6. **Request rules:** the item must be active and not deleted, and belong to the hotel. Quantity must be between 1 and `maxQty`. A note is required when `needsNote` is set. The Concierge request item sets `needsNote`, so free text is always required for it.
10. **Concierge item:** the seed already has "Ask the concierge" (English and Arabic names) in the concierge category, routed to `CONC` with `needsNote` set. That item is the free-text path, so the seed needs no change. Its English name is "Ask the concierge", and the guest-facing name stays as it is unless you want "Concierge request" instead. Guests may submit only while their stay is `ACTIVE` and the token is not revoked.
7. **Language on guest pages:** names and descriptions come from `nameEn` or `nameAr` by locale. Interface copy comes from the existing dictionaries.
8. **Guest copy:** I'll write the Arabic interface text. A fluent reviewer should check it before the pilot.
9. **APP_ORIGIN:** a new env var holds the public base URL for QR links. Local default is `http://localhost:3000`.

## Test plan

- Unit: token generation and hashing, quantity and note rules, reference format.
- Tenant and guest isolation: a guest token from hotel A never reads hotel B; a guest never sees another stay's requests; after check-out or reissue, the old link returns not found.
- Permissions: front desk can check in; an Employee cannot; a GM must have MFA verified.
- Admin flow: check-in refuses an occupied room; reissue invalidates the old card.
- Browser walkthrough: extended to check a guest in, open the link, submit a request, and see it under "My requests".

## Left to the builder

- Exact page layouts, component splits and copy wording within the rules above.
- Whether the stay list paginates. Start without pagination and note it if the seed hotel grows.
