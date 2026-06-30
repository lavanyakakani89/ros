-- CreateTable
CREATE TABLE "label_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "width_mm" DECIMAL(6,2) NOT NULL,
    "height_mm" DECIMAL(6,2) NOT NULL,
    "layout_mode" TEXT NOT NULL DEFAULT '1up',
    "canvas_json" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "label_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "label_print_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "template_id" TEXT,
    "printed_by" TEXT,
    "items" JSONB NOT NULL,
    "total_labels" INTEGER NOT NULL,
    "output_type" TEXT NOT NULL,
    "printed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "label_print_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "label_templates_tenant_id_deleted_at_idx" ON "label_templates"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "label_templates_tenant_id_name_key" ON "label_templates"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "label_templates_created_by_idx" ON "label_templates"("created_by");

-- CreateIndex
CREATE INDEX "label_print_jobs_tenant_id_printed_at_idx" ON "label_print_jobs"("tenant_id", "printed_at");

-- CreateIndex
CREATE INDEX "label_print_jobs_template_id_idx" ON "label_print_jobs"("template_id");

-- CreateIndex
CREATE INDEX "label_print_jobs_printed_by_idx" ON "label_print_jobs"("printed_by");

-- AddForeignKey
ALTER TABLE "label_templates"
  ADD CONSTRAINT "label_templates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id")
  REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "label_templates"
  ADD CONSTRAINT "label_templates_created_by_fkey"
  FOREIGN KEY ("created_by")
  REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "label_print_jobs"
  ADD CONSTRAINT "label_print_jobs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id")
  REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "label_print_jobs"
  ADD CONSTRAINT "label_print_jobs_template_id_fkey"
  FOREIGN KEY ("template_id")
  REFERENCES "label_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "label_print_jobs"
  ADD CONSTRAINT "label_print_jobs_printed_by_fkey"
  FOREIGN KEY ("printed_by")
  REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "label_templates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_label_templates" ON "label_templates"
  USING ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "label_print_jobs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_label_print_jobs" ON "label_print_jobs"
  USING ("tenant_id" = current_setting('app.tenant_id', true));
