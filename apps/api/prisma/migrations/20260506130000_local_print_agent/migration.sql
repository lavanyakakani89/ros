ALTER TYPE "PrinterConn" ADD VALUE IF NOT EXISTS 'LOCAL_AGENT';

ALTER TABLE "printer_configs"
  ADD COLUMN IF NOT EXISTS "local_printer_name" TEXT,
  ADD COLUMN IF NOT EXISTS "local_agent_url" TEXT DEFAULT 'http://127.0.0.1:9211';
