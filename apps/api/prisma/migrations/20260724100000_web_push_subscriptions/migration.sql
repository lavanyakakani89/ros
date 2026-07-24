CREATE TABLE IF NOT EXISTS "web_push_subscriptions" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "web_push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "web_push_subscriptions_endpoint_key" ON "web_push_subscriptions"("endpoint");
CREATE INDEX IF NOT EXISTS "web_push_subscriptions_tenant_id_user_id_idx" ON "web_push_subscriptions"("tenant_id", "user_id");

ALTER TABLE "web_push_subscriptions"
  ADD CONSTRAINT "web_push_subscriptions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "web_push_subscriptions"
  ADD CONSTRAINT "web_push_subscriptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "web_push_subscriptions" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'web_push_subscriptions' AND policyname = 'tenant_isolation_web_push_subscriptions'
  ) THEN
    CREATE POLICY "tenant_isolation_web_push_subscriptions" ON "web_push_subscriptions"
      USING ("tenant_id" = current_setting('app.tenant_id', true));
  END IF;
END $$;
