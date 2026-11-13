# Architecture decisions

Short records of decisions that shape the codebase. Newest last.

## 001 — One app, five experiences
One Next.js codebase serves guests, staff, supervisors, managers and admins, each in its own area of the app.
The brief's "five applications" are five experiences, not five deployments.
Agreed in the MVP plan: the Supervisor and GM dashboards are one screen, scoped by role.

## 002 — Multi-tenant from day one, isolated in two layers
Every table carries `hotel_id`.
The app reaches data only through `tenantDb(hotelId)`, which scopes each query.
Postgres row-level security enforces the same rule for the `hotel_app` role.
Two database roles keep the layers honest:
`hotel_admin` (owns tables, runs migrations, the seed and platform scripts, bypasses RLS) and `hotel_app` (the runtime role, RLS always applies).
Each query runs in a short transaction that sets `app.hotel_id`, at the cost of one extra round trip per query.
That's acceptable at MVP scale; revisit only if profiling says so.

## 003 — Guest tokens resolved through one narrow database function
A guest's QR token has to be resolved before the hotel is known.
`resolve_guest_stay(token_hash)` is a `SECURITY DEFINER` function that returns only `(stay_id, hotel_id)`, and only for a stay that is active, not revoked and not past check-out.
After that, every guest query is scoped to both the hotel and the stay.
Tokens are 32 random bytes; only their SHA-256 hash is stored.

## 004 — Language in the URL
Pages live under `/en/…` and `/ar/…`, following the Next.js 16 internationalisation guide.
Pages prerender per language, and a guest link can open directly in Arabic.
`src/proxy.ts` redirects bare URLs according to the browser's language.

## 005 — Append-only history
`request_events` and `audit_logs` grant the runtime role SELECT and INSERT only.
History can't be edited or deleted from the app, so response-time KPIs stay trustworthy.

## 006 — First migration hand-written; CI proves it matches the schema
The sandbox that built M0 could not download Prisma's migration engine, which is blocked by network policy.
So `20261113000000_init/migration.sql` was written by hand in Prisma's exact conventions.
CI runs `prisma migrate diff --from-migrations … --to-schema … --exit-code`, which fails on any difference between that SQL and `schema.prisma`.
CI also applies the migrations with the real `prisma migrate deploy`.
From M1 on, migrations are generated normally with `prisma migrate dev` on a developer machine.

## 007 — Deferred on purpose
- **Fonts:** M0 uses system font stacks (Georgia for display, system Arabic fonts). Self-hosted brand fonts, including an Arabic display face, are a design-polish task.
- **Hosting region:** default managed hosting for now. Check data-residency requirements with the pilot hotel's IT before M6.
- **Super Admin:** a setup script, not a screen, until about five customers.
