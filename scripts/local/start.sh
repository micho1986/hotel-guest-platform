#!/usr/bin/env bash
# One-command local start (macOS or Linux):  ./scripts/local/start.sh
# Needs Node 20+ and either Docker Desktop (running) or a local PostgreSQL 16.
# Safe to re-run: it reuses the database and only seeds the demo hotel once.
set -euo pipefail
cd "$(dirname "$0")/../.."

command -v node >/dev/null || { echo "Node.js is missing. Install Node 22 from https://nodejs.org and run this again."; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || { echo "Node 20 or newer is needed (you have $(node -v))."; exit 1; }
if command -v pnpm >/dev/null; then PNPM="pnpm"; else PNPM="npx --yes pnpm@12.18.0"; fi

echo "==> Database"
if docker info >/dev/null 2>&1; then
  if docker ps -a --format '{{.Names}}' | grep -qx hotel-pg; then
    docker start hotel-pg >/dev/null
  else
    docker run -d --name hotel-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16 >/dev/null
  fi
  pg() { docker exec -i hotel-pg psql -U postgres -v ON_ERROR_STOP=1 "$@"; }
  for _ in $(seq 1 30); do pg -tAc "select 1" >/dev/null 2>&1 && break; sleep 1; done
  pg -q < scripts/db/setup-roles.sql
  for db in hotel_dev hotel_test; do
    pg -tAc "select 1 from pg_database where datname='$db'" | grep -q 1 || pg -qc "CREATE DATABASE $db OWNER hotel_admin"
  done
elif command -v psql >/dev/null; then
  PGHOST="${PGHOST:-localhost}" PGUSER="${PGUSER:-$(whoami)}" scripts/db/create-databases.sh
else
  echo "No database found. Open Docker Desktop (or install PostgreSQL 16), then run this again."; exit 1
fi

[ -f .env ] || cp .env.example .env
echo "==> Installing packages";  $PNPM install
echo "==> Applying migrations";  $PNPM db:migrate
echo "==> Demo hotel";           $PNPM db:seed
echo
echo "Opening http://localhost:3000/en/staff/login"
echo "  Hotel code: demo-azure-dunes-dubai   Email: admin@demo.hotel   Password: DemoHotel!2026"
echo "Press Ctrl+C to stop."
exec $PNPM dev
