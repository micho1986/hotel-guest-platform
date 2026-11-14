#!/usr/bin/env bash
# Creates the dev and test databases owned by hotel_admin. Safe to re-run.
# Usage: PGHOST=localhost PGUSER=postgres scripts/db/create-databases.sh
set -euo pipefail
# Connect to the maintenance database; without this, psql uses a database named after the OS user.
export PGDATABASE="${PGDATABASE:-postgres}"
psql -v ON_ERROR_STOP=1 -f "$(dirname "$0")/setup-roles.sql"
for db in hotel_dev hotel_test; do
  if ! psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$db'" | grep -q 1; then
    psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE $db OWNER hotel_admin"
  fi
done
echo "Roles and databases ready."
