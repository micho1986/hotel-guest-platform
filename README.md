# Hotel Guest Experience Platform

Guest requests and hotel operations for luxury hotels in the UAE and GCC, in English and Arabic.
Guests scan a QR code in their room to request services, and each request reaches the right department in seconds.
Staff work a live queue, and managers see response times.

**Status: milestones M0 (foundation) and M1 (staff sign-in and hotel setup) complete.** The plan, scope and milestones are in the
*MVP Implementation Plan* doc. Architecture decisions are in [docs/DECISIONS.md](docs/DECISIONS.md).

## What M0 contains

- Next.js 16 + TypeScript + Tailwind, with brand tokens (navy, ivory, champagne, charcoal)
- English and Arabic, with the language in the URL (`/en`, `/ar`) and full right-to-left layout for Arabic
- PostgreSQL schema for every MVP table (Prisma 7), with migrations
- **Two-layer tenant isolation:** an app-layer scoped client plus Postgres row-level security
- Guest access tokens: 32 random bytes, stored only as a SHA-256 hash, revocable and expiring at check-out
- Seed for a **fictional** demo hotel in Dubai (every row flagged `is_demo`)
- Tests T1–T3 (tenant and guest isolation) against a real database, plus CI on GitHub Actions

## What M1 adds

- Staff sign-in with hotel code + email + password; 12-hour server-side sessions
- Account lock for 15 minutes after 5 wrong passwords or codes
- 2-step verification (authenticator app) required for GM and Hotel Admin accounts
- Temporary passwords that must be changed at first sign-in
- Hotel settings screens: profile, departments, rooms (bulk add), staff and roles, service catalogue, audit log
- `pnpm platform:create-hotel` to onboard a new hotel with its first admin
- A real-browser walkthrough test of the whole setup flow (`pnpm test:e2e`)

## Run it locally

Quickest: `./scripts/local/start.sh` (needs Node 20+ and Docker Desktop running, or a local PostgreSQL 16). It sets up the database, seeds the demo hotel and starts the app.

Step by step:

Needs Node 22, pnpm (`corepack enable`), and PostgreSQL 16 running locally.

```bash
pnpm install
cp .env.example .env
PGHOST=localhost PGUSER=postgres pnpm db:setup   # creates roles hotel_admin + hotel_app and the dev/test databases
pnpm db:migrate                                  # apply migrations
pnpm db:seed                                     # fictional demo hotel
pnpm dev                                         # http://localhost:3000
```

| Command | What it does |
|---|---|
| `pnpm test` | Rebuilds the `hotel_test` database from the migrations and runs all tests |
| `pnpm test:e2e` | Browser walkthrough; needs the app running (`pnpm build && pnpm start -p 3010`) and Chrome |
| `pnpm platform:create-hotel --name … --slug … --admin-name … --admin-email …` | Creates a hotel and its first admin; prints a temporary password once |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | Quality gates (CI runs all of them) |
| `pnpm db:reset` | Drops and recreates the dev database (then run `pnpm db:seed`) |
| `pnpm db:check-drift` | Fails if the migrations and `schema.prisma` disagree (needs `SHADOW_DATABASE_URL`) |

### Demo accounts (sample data only)

The seed creates these staff accounts, all with the password `DemoHotel!2026`.
Sign in at `/en/staff/login` with hotel code `demo-azure-dunes-dubai`. The GM and admin accounts set up 2-step verification at first sign-in.

`gm@demo.hotel` · `admin@demo.hotel` · `fo.supervisor@demo.hotel` · `hk.supervisor@demo.hotel` ·
`fb.supervisor@demo.hotel` · `eng.supervisor@demo.hotel` · `hk.attendant@demo.hotel`

The seed also prints a one-time guest token for room 202. Guest pages arrive in M2.

## How tenant isolation works

App code reaches the database only through `tenantDb(hotelId)` in `src/server/db.ts`:

1. **App layer:** every query gets `hotelId` added to its filter, and every created row is stamped with it.
2. **Database layer:** each query runs in a transaction that sets `app.hotel_id`. Row-level security
   policies then let the `hotel_app` role see and write only that hotel's rows.

Either layer alone stops a cross-hotel leak. The tests prove this by disabling each layer in turn.
Migrations, the seed and platform scripts use the separate `hotel_admin` role, which bypasses RLS and is never used by the running app.

## Project layout

```
prisma/schema.prisma            data model (MVP tables)
prisma/migrations/              init (tables) + rls_and_grants (policies, grants, checks)
prisma/seed.ts                  fictional demo hotel
scripts/db/                     role + database setup
src/server/db.ts                tenant-scoped database access
src/server/guest.ts             guest token → stay, guest-scoped queries
src/server/auth/                sign-in, sessions, 2-step codes, permissions
src/server/admin/               hotel setup services (permission-checked, validated)
src/app/[lang]/staff/           staff sign-in and settings screens
scripts/platform/               create-hotel script
src/i18n/                       EN/AR dictionaries, locale helpers
src/proxy.ts                    redirects / to /en or /ar
src/app/[lang]/                 pages
test/                           unit + tenant isolation tests
```
