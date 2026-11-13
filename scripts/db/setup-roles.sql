-- One-time setup, run as a Postgres superuser (local dev and CI).
-- On a managed host (Supabase, Neon, RDS) create the same two roles through its console.
--
-- hotel_admin : owns the tables, runs migrations, seed and platform scripts. Bypasses RLS.
-- hotel_app   : the role the running app connects as. RLS always applies to it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hotel_admin') THEN
    CREATE ROLE hotel_admin LOGIN PASSWORD 'hotel_admin_dev' CREATEDB BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hotel_app') THEN
    CREATE ROLE hotel_app LOGIN PASSWORD 'hotel_app_dev' NOBYPASSRLS;
  END IF;
END $$;
