-- Tenant isolation, layer 2 (database).
-- Layer 1 is the app's tenant-scoped client (src/server/db.ts), which sets
-- app.hotel_id for every query. If layer 1 ever forgets a filter, these
-- policies still return only the current hotel's rows to the hotel_app role.
--
-- Prisma does not model policies, grants, functions or CHECK constraints,
-- so they live in this hand-written migration and are ignored by drift checks.

CREATE FUNCTION app_current_hotel() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.hotel_id', true), '')::uuid $$;

-- hotels: the tenant key is the row's own id.
ALTER TABLE "hotels" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "hotels"
  USING ("id" = app_current_hotel())
  WITH CHECK ("id" = app_current_hotel());

-- Every other table: hotel_id must match the current hotel.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'departments', 'rooms', 'stays', 'staff_users', 'staff_memberships',
    'service_categories', 'service_items', 'requests', 'request_events',
    'request_photos', 'request_feedback', 'sla_rules', 'announcements',
    'notifications', 'audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (hotel_id = app_current_hotel()) WITH CHECK (hotel_id = app_current_hotel())',
      t
    );
  END LOOP;
END $$;

-- Runtime role. Hotels are created by the platform setup script (admin role), so the app may only read and update its own hotel row.
GRANT USAGE ON SCHEMA public TO hotel_app;
GRANT SELECT, UPDATE ON "hotels" TO hotel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "departments", "rooms", "stays", "staff_users", "staff_memberships",
  "service_categories", "service_items", "requests", "request_photos",
  "request_feedback", "sla_rules", "announcements", "notifications"
  TO hotel_app;
-- Append-only history: the app can add rows but never change or remove them.
GRANT SELECT, INSERT ON "request_events", "audit_logs" TO hotel_app;
GRANT EXECUTE ON FUNCTION app_current_hotel() TO hotel_app;

-- A guest's QR token must be resolved before the app knows which hotel it
-- belongs to. This is the one narrow, audited way across the tenant boundary:
-- given a token HASH it returns only the stay id and hotel id, and only for a
-- stay that is active, not revoked and not past check-out.
CREATE FUNCTION resolve_guest_stay(token_hash text)
  RETURNS TABLE (stay_id uuid, hotel_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT s."id", s."hotel_id"
    FROM "stays" s
    WHERE s."access_token_hash" = token_hash
      AND s."status" = 'ACTIVE'
      AND s."token_revoked_at" IS NULL
      AND s."check_out" > now()
  $$;
REVOKE ALL ON FUNCTION resolve_guest_stay(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_guest_stay(text) TO hotel_app;

-- Data rules Prisma cannot express.
ALTER TABLE "request_feedback" ADD CONSTRAINT "request_feedback_rating_check" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "requests" ADD CONSTRAINT "requests_qty_check" CHECK ("qty" >= 1);
ALTER TABLE "requests" ADD CONSTRAINT "requests_escalation_level_check" CHECK ("escalation_level" BETWEEN 0 AND 2);
