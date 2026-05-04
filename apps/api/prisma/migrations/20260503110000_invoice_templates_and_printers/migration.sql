-- CreateEnum
CREATE TYPE "PaperSize" AS ENUM ('THERMAL_2', 'THERMAL_3', 'THERMAL_4', 'A5', 'A4');

-- CreateEnum
CREATE TYPE "RenderType" AS ENUM ('ESC_POS', 'HTML_PDF');

-- CreateEnum
CREATE TYPE "PrinterConn" AS ENUM ('USB_PRINTNODE', 'NETWORK', 'BLUETOOTH', 'NONE');

-- CreateTable
CREATE TABLE "invoice_templates" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "paper_size" "PaperSize" NOT NULL,
  "render_type" "RenderType" NOT NULL,
  "html_source" TEXT,
  "escpos_config" JSONB,
  "ui_config" JSONB,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "is_locked" BOOLEAN NOT NULL DEFAULT false,
  "cloned_from_id" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "invoice_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printer_configs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "connection_type" "PrinterConn" NOT NULL DEFAULT 'NONE',
  "paper_size" "PaperSize" NOT NULL DEFAULT 'THERMAL_3',
  "network_ip" TEXT,
  "network_port" INTEGER,
  "print_node_api_key" TEXT,
  "print_node_printer_id" TEXT,
  "bluetooth_device_id" TEXT,
  "bluetooth_device_name" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "last_tested_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "printer_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_templates_tenant_id_name_key" ON "invoice_templates"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "invoice_templates_tenant_id_is_default_idx" ON "invoice_templates"("tenant_id", "is_default");

-- CreateIndex
CREATE INDEX "invoice_templates_paper_size_render_type_idx" ON "invoice_templates"("paper_size", "render_type");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_templates_system_name_key" ON "invoice_templates"("name") WHERE "tenant_id" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "invoice_templates_one_default_per_tenant_key" ON "invoice_templates"("tenant_id") WHERE "tenant_id" IS NOT NULL AND "is_default" = true;

-- CreateIndex
CREATE UNIQUE INDEX "printer_configs_tenant_id_key" ON "printer_configs"("tenant_id");

-- AddForeignKey
ALTER TABLE "invoice_templates" ADD CONSTRAINT "invoice_templates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_templates" ADD CONSTRAINT "invoice_templates_cloned_from_id_fkey"
  FOREIGN KEY ("cloned_from_id") REFERENCES "invoice_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printer_configs" ADD CONSTRAINT "printer_configs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enable RLS for tenant data. System templates remain readable for all tenants.
ALTER TABLE "invoice_templates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_invoice_templates" ON "invoice_templates"
  USING ("tenant_id" IS NULL OR "tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" IS NULL OR "tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "printer_configs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_printer_configs" ON "printer_configs"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

-- Seed locked system templates used as the source for shop-level clones.
INSERT INTO "invoice_templates" (
  "id",
  "tenant_id",
  "name",
  "description",
  "paper_size",
  "render_type",
  "html_source",
  "escpos_config",
  "ui_config",
  "is_system",
  "is_default",
  "is_locked",
  "cloned_from_id",
  "version",
  "created_at",
  "updated_at"
) VALUES
  (
    'system-thermal-2',
    NULL,
    '2 inch thermal receipt',
    'Compact grocery and restaurant receipt template.',
    'THERMAL_2',
    'ESC_POS',
    NULL,
    '{"columns": 32, "showHsn": false, "showGstSplit": false, "cut": true}',
    '{"header": {"showLogo": false, "showGstin": true}, "items": {"showMrp": false, "showDiscount": true}, "footer": {"showQr": false, "message": "Thank you"}}',
    true,
    false,
    true,
    NULL,
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'system-thermal-3',
    NULL,
    '3 inch GST thermal receipt',
    'Detailed thermal receipt for pharmacy and hardware shops.',
    'THERMAL_3',
    'ESC_POS',
    NULL,
    '{"columns": 42, "showHsn": true, "showGstSplit": true, "showBatch": true, "cut": true}',
    '{"header": {"showLogo": false, "showGstin": true}, "items": {"showMrp": true, "showDiscount": true, "showBatch": true}, "footer": {"showQr": true, "message": "Please visit again"}}',
    true,
    false,
    true,
    NULL,
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'system-thermal-4',
    NULL,
    '4 inch thermal invoice',
    'Wide thermal format with GST columns.',
    'THERMAL_4',
    'ESC_POS',
    NULL,
    '{"columns": 56, "showHsn": true, "showGstSplit": true, "cut": true}',
    '{"header": {"showLogo": false, "showGstin": true}, "items": {"showMrp": true, "showDiscount": true}, "footer": {"showQr": true, "message": "Thank you"}}',
    true,
    false,
    true,
    NULL,
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'system-a5-invoice',
    NULL,
    'A5 branded GST invoice',
    'Half-page PDF invoice for fashion and electronics.',
    'A5',
    'HTML_PDF',
    '<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;margin:20px;color:#111827}.head{border-bottom:2px solid #111827;padding-bottom:10px}.shop{font-size:22px;font-weight:700}.muted{font-size:12px;color:#4b5563}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}th,td{border:1px solid #d1d5db;padding:6px}.num{text-align:right}.total{font-size:18px;font-weight:700;text-align:right;margin-top:16px}</style></head><body><section class="head"><div class="shop">{{tenant.name}}</div><div class="muted">{{tenant.address}}</div><div class="muted">Phone {{tenant.phone}} GSTIN {{tenant.gstNumber}}</div><div>Invoice {{invoice.invoiceNumber}} | {{invoiceDate}}</div></section><table><thead><tr><th>Item</th><th>Qty</th><th class="num">Rate</th><th class="num">GST</th><th class="num">Total</th></tr></thead><tbody>{{#each items}}<tr><td>{{productName}}</td><td>{{quantity}}</td><td class="num">{{sellingPrice}}</td><td class="num">{{gstRate}}%</td><td class="num">{{total}}</td></tr>{{/each}}</tbody></table><div class="total">Total Rs. {{grandTotal}}</div><p class="muted">This is a computer-generated GST invoice.</p></body></html>',
    NULL,
    '{"header": {"showLogo": true, "showGstin": true}, "items": {"showMrp": true, "showDiscount": true}, "footer": {"showQr": true, "message": "Thank you"}}',
    true,
    false,
    true,
    NULL,
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'system-a4-invoice',
    NULL,
    'A4 detailed GST invoice',
    'Full-page PDF invoice for exports, B2B billing, and reports.',
    'A4',
    'HTML_PDF',
    '<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;margin:32px;color:#111827}.header{display:flex;justify-content:space-between;border-bottom:2px solid #111827;padding-bottom:16px}.tenant{font-size:24px;font-weight:700}.muted{color:#4b5563;font-size:12px;line-height:1.5}.title{text-align:right;font-size:20px;font-weight:700}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}th,td{border:1px solid #d1d5db;padding:8px;text-align:left}th{background:#f3f4f6}.num{text-align:right}.totals{margin-left:auto;margin-top:18px;width:320px;font-size:13px}.totals div{display:flex;justify-content:space-between;padding:5px 0}.grand{border-top:2px solid #111827;font-weight:700;font-size:16px}</style></head><body><section class="header"><div><div class="tenant">{{tenant.name}}</div><div class="muted">{{tenant.address}}</div><div class="muted">Phone: {{tenant.phone}}</div><div class="muted">GSTIN: {{tenant.gstNumber}}</div></div><div><div class="title">GST Invoice</div><div class="muted">Invoice: {{invoice.invoiceNumber}}</div><div class="muted">Date: {{invoiceDate}}</div></div></section><table><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th class="num">Rate</th><th class="num">GST %</th><th class="num">CGST</th><th class="num">SGST</th><th class="num">Total</th></tr></thead><tbody>{{#each items}}<tr><td>{{productName}}</td><td>{{quantity}}</td><td>{{unit}}</td><td class="num">{{sellingPrice}}</td><td class="num">{{gstRate}}</td><td class="num">{{cgst}}</td><td class="num">{{sgst}}</td><td class="num">{{total}}</td></tr>{{/each}}</tbody></table><section class="totals"><div><span>Subtotal</span><span>Rs. {{subtotal}}</span></div><div><span>Discount</span><span>Rs. {{totalDiscount}}</span></div><div><span>CGST</span><span>Rs. {{totalCgst}}</span></div><div><span>SGST</span><span>Rs. {{totalSgst}}</span></div><div class="grand"><span>Grand total</span><span>Rs. {{grandTotal}}</span></div></section><p class="muted">Amount in words: {{inWords}}</p></body></html>',
    NULL,
    '{"header": {"showLogo": true, "showGstin": true}, "items": {"showMrp": true, "showDiscount": true}, "footer": {"showQr": true, "message": "Thank you"}}',
    true,
    false,
    true,
    NULL,
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO NOTHING;
