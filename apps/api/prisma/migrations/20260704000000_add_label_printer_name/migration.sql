-- Add label printer queue name to printer configurations.
ALTER TABLE "printer_configs"
  ADD COLUMN IF NOT EXISTS "label_printer_name" TEXT;
