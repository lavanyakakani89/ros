CREATE TYPE "UnusedPaidLeavePolicy" AS ENUM ('NONE', 'PAY_IN_PAYROLL');

ALTER TABLE "employees"
ADD COLUMN "unused_paid_leave_policy" "UnusedPaidLeavePolicy" NOT NULL DEFAULT 'NONE';
