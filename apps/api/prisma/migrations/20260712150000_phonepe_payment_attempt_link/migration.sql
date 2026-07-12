ALTER TABLE "invoice_payments"
ADD COLUMN "payment_integration_attempt_id" TEXT;

CREATE UNIQUE INDEX "invoice_payments_payment_integration_attempt_id_key"
ON "invoice_payments"("payment_integration_attempt_id");

ALTER TABLE "invoice_payments"
ADD CONSTRAINT "invoice_payments_payment_integration_attempt_id_fkey"
FOREIGN KEY ("payment_integration_attempt_id")
REFERENCES "payment_integration_attempts"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
