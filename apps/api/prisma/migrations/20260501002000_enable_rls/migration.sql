ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_users" ON "users"
  USING ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_products" ON "products"
  USING ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "product_batches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_product_batches" ON "product_batches"
  USING ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_customers" ON "customers"
  USING ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_invoices" ON "invoices"
  USING ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "invoice_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_invoice_items" ON "invoice_items"
  USING ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_payments" ON "payments"
  USING ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "deliveries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_deliveries" ON "deliveries"
  USING ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_suppliers" ON "suppliers"
  USING ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_purchase_orders" ON "purchase_orders"
  USING ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "purchase_order_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_purchase_order_items" ON "purchase_order_items"
  USING ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_refresh_tokens" ON "refresh_tokens"
  USING ("tenant_id" = current_setting('app.tenant_id', true));
