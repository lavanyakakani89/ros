import { z } from "zod";

export const reportDateRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type ReportDateRange = z.infer<typeof reportDateRangeSchema>;
