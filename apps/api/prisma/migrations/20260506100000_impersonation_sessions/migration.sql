CREATE TYPE "ImpersonationAccessLevel" AS ENUM ('READ_ONLY', 'WRITE');

CREATE TYPE "ImpersonationEndReason" AS ENUM ('EXIT', 'EXPIRED', 'FORCE_ENDED');

ALTER TABLE "super_admin_logs"
  ADD COLUMN "metadata" JSONB;

CREATE TABLE "impersonation_sessions" (
  "id" TEXT NOT NULL,
  "super_admin_id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "access_level" "ImpersonationAccessLevel" NOT NULL,
  "reason" TEXT,
  "token_hash" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "ended_at" TIMESTAMP(3),
  "end_reason" "ImpersonationEndReason",
  "actions_count" INTEGER NOT NULL DEFAULT 0,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "impersonation_sessions_tenant_id_idx" ON "impersonation_sessions"("tenant_id");
CREATE INDEX "impersonation_sessions_super_admin_id_idx" ON "impersonation_sessions"("super_admin_id");
CREATE INDEX "impersonation_sessions_expires_at_idx" ON "impersonation_sessions"("expires_at");
CREATE INDEX "impersonation_sessions_ended_at_idx" ON "impersonation_sessions"("ended_at");

ALTER TABLE "impersonation_sessions"
  ADD CONSTRAINT "impersonation_sessions_super_admin_id_fkey"
  FOREIGN KEY ("super_admin_id") REFERENCES "super_admins"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "impersonation_sessions"
  ADD CONSTRAINT "impersonation_sessions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "impersonation_sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_impersonation_sessions" ON "impersonation_sessions"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "audit_logs_no_update_delete" ON "audit_logs";
CREATE TRIGGER "audit_logs_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

DROP TRIGGER IF EXISTS "super_admin_logs_no_update_delete" ON "super_admin_logs";
CREATE TRIGGER "super_admin_logs_no_update_delete"
  BEFORE UPDATE OR DELETE ON "super_admin_logs"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
