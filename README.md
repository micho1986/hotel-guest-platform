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
`fb.supervisor@demo.hotel` · `eng.supervisor@demo.hotel` · `hk.attendant@demo.hotel` · `frontdesk@demo.hotel`

### Guest access and the front desk

The front desk checks guests in from **Staff home → Front desk**. Each check-in or reissue shows a printable card with two QR codes, one for the English guest page and one for the Arabic page. The card is shown once; reissuing a link makes the old one stop working at once.

The seed also prints a guest token for room 202, valid three days. To try the guest pages locally, open `/en/g/<token>` or `/ar/g/<token>` on the running app. Set `APP_ORIGIN` (see `.env.example`) so the QR codes point at the right address; in production it is required.

## Supervisor alerts (M4)

A New request that nobody has accepted alerts its department's supervisors after **5 minutes** (urgent) or **10 minutes**
(normal), and again each window while it stays New. A department with no supervisor alerts the hotel admins instead.
Alerts appear on the request queue with a sound, and as web push on devices where a supervisor turned alerts on.

The alerts come from `GET /api/jobs/alerts`, which an external scheduler must call. Set `ALERT_JOB_SECRET` (see
`.env.example`) and call the route every **15 seconds** where the scheduler allows it, and at least **every minute**:

```bash
curl -fsS -H "Authorization: Bearer $ALERT_JOB_SECRET" https://<your-app-origin>/api/jobs/alerts
# → {"alerted":0}
```

- Without the header, or with the wrong secret, the route answers `401` and does nothing.
- The job is idempotent: running it twice in the same window sends one alert per request, so overlapping or retried
  calls are safe.
- Any scheduler that can send a bearer header works (a cron service, the hosting platform's scheduler, or a
  `cron` line on a server). Which one runs in production is still open; until one is set up, alerts fire only when
  the route is called by hand.
- Push needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (see `.env.example`). Without them, alerts
  still show on the queue screen. On iPhone, web push works only after the staff site is added to the home screen.

Locally, with the app running and the secret in `.env`:

```bash
while true; do curl -fsS -H "Authorization: Bearer $ALERT_JOB_SECRET" http://localhost:3000/api/jobs/alerts; echo; sleep 15; done
```

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
