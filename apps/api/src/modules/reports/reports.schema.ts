import { z } from "zod";

import { dateParamSchema } from "../../lib/date-range.js";

export const reportDateRangeSchema = z.object({
  from: dateParamSchema("start"),
  to: dateParamSchema("end"),
});

export type ReportDateRange = z.infer<typeof reportDateRangeSchema>;
