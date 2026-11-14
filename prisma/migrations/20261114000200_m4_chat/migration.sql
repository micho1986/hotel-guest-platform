-- CreateTable
CREATE TABLE "chat_channels" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "author_staff_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_channels_department_id_key" ON "chat_channels"("department_id");

-- CreateIndex
CREATE INDEX "chat_channels_hotel_id_idx" ON "chat_channels"("hotel_id");

-- CreateIndex
CREATE INDEX "chat_messages_channel_id_created_at_idx" ON "chat_messages"("channel_id", "created_at");

-- AddForeignKey
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "chat_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_staff_id_fkey" FOREIGN KEY ("author_staff_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Hand-written below: RLS, grants, channel trigger and backfill (ignored by drift checks) ──

ALTER TABLE "chat_channels" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "chat_channels"
  USING (hotel_id = app_current_hotel())
  WITH CHECK (hotel_id = app_current_hotel());

ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "chat_messages"
  USING (hotel_id = app_current_hotel())
  WITH CHECK (hotel_id = app_current_hotel());

-- Channels are created by the trigger below; messages are append-only history.
GRANT SELECT, INSERT ON "chat_channels", "chat_messages" TO hotel_app;

-- Every department gets its channel when it is created, whichever path creates it (settings screen,
-- seed, platform script). Runs as the inserting role, so RLS still checks the hotel.
CREATE FUNCTION create_department_chat_channel() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
  AS $$
  BEGIN
    INSERT INTO "chat_channels" ("id", "hotel_id", "department_id", "is_demo")
    VALUES (gen_random_uuid(), NEW."hotel_id", NEW."id", NEW."is_demo");
    RETURN NEW;
  END
  $$;

CREATE TRIGGER departments_create_chat_channel
  AFTER INSERT ON "departments"
  FOR EACH ROW EXECUTE FUNCTION create_department_chat_channel();

-- Departments that existed before this migration.
INSERT INTO "chat_channels" ("id", "hotel_id", "department_id", "is_demo")
SELECT gen_random_uuid(), d."hotel_id", d."id", d."is_demo" FROM "departments" d;
