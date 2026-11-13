-- AlterTable
ALTER TABLE "staff_users" ADD COLUMN     "failed_login_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_until" TIMESTAMPTZ(3),
ADD COLUMN     "mfa_enabled_at" TIMESTAMPTZ(3),
ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "staff_sessions" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "mfa_verified_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_sessions_token_hash_key" ON "staff_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "staff_sessions_staff_user_id_idx" ON "staff_sessions"("staff_user_id");

-- AddForeignKey
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written below: RLS, grants and lookup functions (ignored by drift checks) ──

ALTER TABLE "staff_sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_sessions"
  USING (hotel_id = app_current_hotel())
  WITH CHECK (hotel_id = app_current_hotel());
GRANT SELECT, INSERT, UPDATE, DELETE ON "staff_sessions" TO hotel_app;

-- Login: the hotel code typed on the sign-in form → that hotel's id and status.
-- Returns nothing else, so it can't be used to browse hotels.
CREATE FUNCTION find_hotel_by_slug(p_slug text)
  RETURNS TABLE (hotel_id uuid, status "HotelStatus")
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$ SELECT h."id", h."status" FROM "hotels" h WHERE h."slug" = lower(p_slug) $$;
REVOKE ALL ON FUNCTION find_hotel_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_hotel_by_slug(text) TO hotel_app;

-- Every staff request: session cookie token HASH → which hotel and staff member.
-- Only unexpired sessions of active staff in active hotels.
CREATE FUNCTION resolve_staff_session(p_token_hash text)
  RETURNS TABLE (session_id uuid, hotel_id uuid, staff_user_id uuid, mfa_verified_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT s."id", s."hotel_id", s."staff_user_id", s."mfa_verified_at"
    FROM "staff_sessions" s
    JOIN "staff_users" u ON u."id" = s."staff_user_id"
    JOIN "hotels" h ON h."id" = s."hotel_id"
    WHERE s."token_hash" = p_token_hash
      AND s."expires_at" > now()
      AND u."status" = 'ACTIVE'
      AND u."deleted_at" IS NULL
      AND h."status" = 'ACTIVE'
  $$;
REVOKE ALL ON FUNCTION resolve_staff_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_staff_session(text) TO hotel_app;
