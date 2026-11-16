-- AlterTable
ALTER TABLE "service_items" ADD COLUMN "external_key" TEXT;

-- CreateTable
CREATE TABLE "service_orders" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order_lines" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "service_item_id" UUID NOT NULL,
    "name_snapshot" TEXT NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "qty" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_items_hotel_id_external_key_key" ON "service_items"("hotel_id", "external_key");

-- CreateIndex
CREATE UNIQUE INDEX "service_orders_request_id_key" ON "service_orders"("request_id");

-- CreateIndex
CREATE INDEX "service_order_lines_order_id_idx" ON "service_order_lines"("order_id");

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_lines" ADD CONSTRAINT "service_order_lines_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_lines" ADD CONSTRAINT "service_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_lines" ADD CONSTRAINT "service_order_lines_service_item_id_fkey" FOREIGN KEY ("service_item_id") REFERENCES "service_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Hand-written below: RLS and grants (ignored by drift checks) ──

ALTER TABLE "service_orders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "service_orders"
  USING (hotel_id = app_current_hotel())
  WITH CHECK (hotel_id = app_current_hotel());

ALTER TABLE "service_order_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "service_order_lines"
  USING (hotel_id = app_current_hotel())
  WITH CHECK (hotel_id = app_current_hotel());

GRANT SELECT, INSERT ON "service_orders", "service_order_lines" TO hotel_app;
