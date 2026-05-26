import { AttendanceStatus, EmployeeStatus, PayAdvanceStatus, PayrollStatus, SalaryType, UserRole, type Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyPluginCallback, FastifyReply } from "fastify";
import { z } from "zod";

class PayrollError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

const dateOnlySchema = z.preprocess((value) => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }

  return value;
}, z.date());

const timeSchema = z
  .string()
  .trim()
  .regex(/^\d{2}:\d{2}(?::\d{2})?$/, "Use HH:mm or HH:mm:ss")
  .nullable()
  .optional();

const employeePayloadSchema = z.object({
  name: z.string().trim().min(2).max(128),
  phone: z.string().trim().min(6).max(32),
  role: z.string().trim().min(2).max(64),
  department: z.string().trim().min(2).max(64),
  baseSalary: z.coerce.number().finite().nonnegative(),
  salaryType: z.nativeEnum(SalaryType),
  status: z.nativeEnum(EmployeeStatus).default(EmployeeStatus.ACTIVE),
  joinedAt: dateOnlySchema,
});

const employeeUpdateSchema = employeePayloadSchema.partial();

const attendancePayloadSchema = z.object({
  employeeId: z.string().min(1),
  date: dateOnlySchema,
  status: z.nativeEnum(AttendanceStatus),
  shiftStart: timeSchema,
  shiftEnd: timeSchema,
  overtimeMinutes: z.coerce.number().int().min(0).default(0),
  note: z.string().trim().max(500).nullable().optional(),
});

const advancePayloadSchema = z.object({
  employeeId: z.string().min(1),
  amount: z.coerce.number().finite().positive(),
  reason: z.string().trim().max(500).nullable().optional(),
});

const advanceStatusSchema = z.object({
  status: z.nativeEnum(PayAdvanceStatus).refine((status) => status !== PayAdvanceStatus.PENDING, "Status must be APPROVED, REJECTED, or RECOVERED"),
  recoveredIn: z.string().min(1).nullable().optional(),
});

const periodSchema = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");

const payrollRunPayloadSchema = z.object({
  period: periodSchema,
  notes: z.string().trim().max(1000).nullable().optional(),
});

const otherDeductionSchema = z.object({
  employeeId: z.string().min(1),
  amount: z.coerce.number().finite().nonnegative(),
  note: z.string().trim().max(250).optional(),
});

const generateRunSchema = z.object({
  otherDeductions: z.array(otherDeductionSchema).default([]),
});

const runStatusSchema = z.object({
  status: z.nativeEnum(PayrollStatus).refine((status) => status !== PayrollStatus.DRAFT, "Status must be APPROVED or PAID"),
});

const disburseRunSchema = z.object({
  paymentMethodId: z.string().min(1),
  paidAt: dateOnlySchema.optional(),
  referencePrefix: z.string().trim().max(80).optional(),
  payslipLineIds: z.array(z.string().min(1)).optional(),
});

const disbursementVoidSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const payslipUpdateSchema = z.object({
  otherDeductions: z.coerce.number().finite().nonnegative().optional(),
  breakdown: z.record(z.unknown()).optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

const disbursementInclude = {
  employee: { select: { id: true, name: true, department: true } },
  payrollRun: true,
  payslipLine: true,
  paymentMethod: true,
  paidBy: { select: { name: true } },
  voidAuthorisedBy: { select: { name: true } },
} satisfies Prisma.PayrollDisbursementInclude;

export const payrollRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/payroll/employees", async (request) => {
    const query = z.object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(50),
      status: z.nativeEnum(EmployeeStatus).optional(),
      department: z.string().trim().min(1).optional(),
      search: z.string().trim().min(1).optional(),
    }).parse(request.query);

    const where = {
      tenantId: request.tenant.id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.department ? { department: query.department } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" as const } },
              { phone: { contains: query.search } },
              { role: { contains: query.search, mode: "insensitive" as const } },
              { department: { contains: query.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [total, employees] = await Promise.all([
      fastify.prisma.employee.count({ where }),
      fastify.prisma.employee.findMany({
        where,
        include: { _count: { select: { attendance: true, payAdvances: true, payslipLines: true } } },
        orderBy: [{ status: "asc" }, { name: "asc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return { data: employees.map(formatEmployee), page: query.page, limit: query.limit, total };
  });

  fastify.post("/api/payroll/employees", async (request, reply) => {
    ensurePayrollManager(request.user.role);
    const input = employeePayloadSchema.parse(request.body);
    const employee = await fastify.prisma.employee.create({
      data: {
        tenantId: request.tenant.id,
        name: input.name,
        phone: input.phone,
        role: input.role,
        department: input.department,
        baseSalary: input.baseSalary,
        salaryType: input.salaryType,
        status: input.status,
        joinedAt: input.joinedAt,
      },
    });
    await writePayrollAudit(fastify, request.tenant.id, request.user.userId, "PAYROLL_EMPLOYEE_CREATED", "EMPLOYEE", employee.id, input, request.ip);
    return reply.status(201).send(formatEmployee(employee));
  });

  fastify.get("/api/payroll/employees/:id", async (request, reply) => {
    return handlePayroll(reply, async () => {
      const { id } = idParamsSchema.parse(request.params);
      const employee = await fastify.prisma.employee.findFirst({
        where: { id, tenantId: request.tenant.id },
        include: {
          attendance: { orderBy: { date: "desc" }, take: 30 },
          payAdvances: { orderBy: { requestedAt: "desc" }, take: 30 },
          payslipLines: { include: { payrollRun: true }, orderBy: { payrollRun: { runAt: "desc" } }, take: 12 },
        },
      });
      if (!employee) throw new PayrollError("Employee not found", 404);
      return {
        ...formatEmployee(employee),
        attendance: employee.attendance.map(formatAttendance),
        payAdvances: employee.payAdvances.map(formatPayAdvance),
        payslips: employee.payslipLines.map(formatPayslipLine),
      };
    });
  });

  fastify.patch("/api/payroll/employees/:id", async (request, reply) => {
    return handlePayroll(reply, async () => {
      ensurePayrollManager(request.user.role);
      const { id } = idParamsSchema.parse(request.params);
      const input = employeeUpdateSchema.parse(request.body);
      const result = await fastify.prisma.employee.updateMany({
        where: { id, tenantId: request.tenant.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.department !== undefined ? { department: input.department } : {}),
          ...(input.baseSalary !== undefined ? { baseSalary: input.baseSalary } : {}),
          ...(input.salaryType !== undefined ? { salaryType: input.salaryType } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.joinedAt !== undefined ? { joinedAt: input.joinedAt } : {}),
        },
      });
      if (result.count === 0) throw new PayrollError("Employee not found", 404);
      const employee = await getEmployeeOrThrow(fastify, request.tenant.id, id);
      await writePayrollAudit(fastify, request.tenant.id, request.user.userId, "PAYROLL_EMPLOYEE_UPDATED", "EMPLOYEE", id, input, request.ip);
      return formatEmployee(employee);
    });
  });

  fastify.delete("/api/payroll/employees/:id", async (request, reply) => {
    return handlePayroll(reply, async () => {
      ensurePayrollManager(request.user.role);
      const { id } = idParamsSchema.parse(request.params);
      const result = await fastify.prisma.employee.updateMany({
        where: { id, tenantId: request.tenant.id },
        data: { status: EmployeeStatus.TERMINATED },
      });
      if (result.count === 0) throw new PayrollError("Employee not found", 404);
      await writePayrollAudit(fastify, request.tenant.id, request.user.userId, "PAYROLL_EMPLOYEE_TERMINATED", "EMPLOYEE", id, {}, request.ip);
      return { status: "ok" };
    });
  });

  fastify.get("/api/payroll/attendance", async (request) => {
    const query = z.object({
      employeeId: z.string().min(1).optional(),
      status: z.nativeEnum(AttendanceStatus).optional(),
      dateFrom: dateOnlySchema.optional(),
      dateTo: dateOnlySchema.optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(200).default(100),
    }).parse(request.query);
    const toExclusive = query.dateTo ? addDays(query.dateTo, 1) : undefined;
    const where = {
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.status ? { status: query.status } : {}),
      employee: { tenantId: request.tenant.id },
      ...(query.dateFrom || toExclusive
        ? { date: { ...(query.dateFrom ? { gte: query.dateFrom } : {}), ...(toExclusive ? { lt: toExclusive } : {}) } }
        : {}),
    };
    const [total, rows] = await Promise.all([
      fastify.prisma.attendance.count({ where }),
      fastify.prisma.attendance.findMany({
        where,
        include: { employee: { select: { id: true, name: true, department: true } } },
        orderBy: [{ date: "desc" }, { employee: { name: "asc" } }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return { data: rows.map(formatAttendance), page: query.page, limit: query.limit, total };
  });

  fastify.post("/api/payroll/attendance", async (request, reply) => {
    return handlePayroll(reply, async () => {
      ensurePayrollManager(request.user.role);
      const input = attendancePayloadSchema.parse(request.body);
      await getEmployeeOrThrow(fastify, request.tenant.id, input.employeeId);
      const attendance = await fastify.prisma.attendance.upsert({
        where: { employeeId_date: { employeeId: input.employeeId, date: input.date } },
        update: {
          status: input.status,
          shiftStart: timeToDate(input.shiftStart),
          shiftEnd: timeToDate(input.shiftEnd),
          overtimeMinutes: input.overtimeMinutes,
          note: input.note ?? null,
        },
        create: {
          employeeId: input.employeeId,
          date: input.date,
          status: input.status,
          shiftStart: timeToDate(input.shiftStart),
          shiftEnd: timeToDate(input.shiftEnd),
          overtimeMinutes: input.overtimeMinutes,
          note: input.note ?? null,
        },
        include: { employee: { select: { id: true, name: true, department: true } } },
      });
      return reply.status(201).send(formatAttendance(attendance));
    });
  });

  fastify.get("/api/payroll/advances", async (request) => {
    const query = z.object({
      employeeId: z.string().min(1).optional(),
      status: z.nativeEnum(PayAdvanceStatus).optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(50),
    }).parse(request.query);
    const where = {
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.status ? { status: query.status } : {}),
      employee: { tenantId: request.tenant.id },
    };
    const [total, advances] = await Promise.all([
      fastify.prisma.payAdvance.count({ where }),
      fastify.prisma.payAdvance.findMany({
        where,
        include: { employee: { select: { id: true, name: true, department: true } }, recoveredInRun: true },
        orderBy: { requestedAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return { data: advances.map(formatPayAdvance), page: query.page, limit: query.limit, total };
  });

  fastify.post("/api/payroll/advances", async (request, reply) => {
    return handlePayroll(reply, async () => {
      ensurePayrollManager(request.user.role);
      const input = advancePayloadSchema.parse(request.body);
      await getEmployeeOrThrow(fastify, request.tenant.id, input.employeeId);
      const advance = await fastify.prisma.payAdvance.create({
        data: {
          employeeId: input.employeeId,
          amount: input.amount,
          reason: input.reason ?? null,
        },
        include: { employee: { select: { id: true, name: true, department: true } } },
      });
      await writePayrollAudit(fastify, request.tenant.id, request.user.userId, "PAY_ADVANCE_CREATED", "PAY_ADVANCE", advance.id, input, request.ip);
      return reply.status(201).send(formatPayAdvance(advance));
    });
  });

  fastify.patch("/api/payroll/advances/:id/status", async (request, reply) => {
    return handlePayroll(reply, async () => {
      ensurePayrollManager(request.user.role);
      const { id } = idParamsSchema.parse(request.params);
      const input = advanceStatusSchema.parse(request.body);
      const existing = await fastify.prisma.payAdvance.findFirst({ where: { id, employee: { tenantId: request.tenant.id } } });
      if (!existing) throw new PayrollError("Pay advance not found", 404);
      if (input.recoveredIn) await getPayrollRunOrThrow(fastify, request.tenant.id, input.recoveredIn);
      const advance = await fastify.prisma.payAdvance.update({
        where: { id },
        data: {
          status: input.status,
          ...(input.status === PayAdvanceStatus.APPROVED ? { approvedAt: new Date(), approvedBy: request.user.userId } : {}),
          ...(input.status === PayAdvanceStatus.REJECTED ? { approvedAt: null, approvedBy: null, recoveredIn: null } : {}),
          ...(input.status === PayAdvanceStatus.RECOVERED ? { recoveredIn: input.recoveredIn ?? existing.recoveredIn } : {}),
        },
        include: { employee: { select: { id: true, name: true, department: true } }, recoveredInRun: true },
      });
      await writePayrollAudit(fastify, request.tenant.id, request.user.userId, "PAY_ADVANCE_STATUS_UPDATED", "PAY_ADVANCE", id, input, request.ip);
      return formatPayAdvance(advance);
    });
  });

  fastify.get("/api/payroll/runs", async (request) => {
    const query = z.object({
      status: z.nativeEnum(PayrollStatus).optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(50),
    }).parse(request.query);
    const where = { tenantId: request.tenant.id, ...(query.status ? { status: query.status } : {}) };
    const [total, runs] = await Promise.all([
      fastify.prisma.payrollRun.count({ where }),
      fastify.prisma.payrollRun.findMany({
        where,
        include: { _count: { select: { payslipLines: true, recoveredAdvances: true } } },
        orderBy: { period: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return { data: runs.map(formatPayrollRun), page: query.page, limit: query.limit, total };
  });

  fastify.post("/api/payroll/runs", async (request, reply) => {
    ensurePayrollManager(request.user.role);
    const input = payrollRunPayloadSchema.parse(request.body);
    const run = await fastify.prisma.payrollRun.create({
      data: {
        tenantId: request.tenant.id,
        period: input.period,
        notes: input.notes ?? null,
        runBy: request.user.userId,
      },
    });
    await writePayrollAudit(fastify, request.tenant.id, request.user.userId, "PAYROLL_RUN_CREATED", "PAYROLL_RUN", run.id, input, request.ip);
    return reply.status(201).send(formatPayrollRun(run));
  });

  fastify.get("/api/payroll/runs/:id", async (request, reply) => {
    return handlePayroll(reply, async () => {
      const { id } = idParamsSchema.parse(request.params);
      const run = await getPayrollRunOrThrow(fastify, request.tenant.id, id);
      return formatPayrollRunDetail(run);
    });
  });

  fastify.post("/api/payroll/runs/:id/generate", async (request, reply) => {
    return handlePayroll(reply, async () => {
      ensurePayrollManager(request.user.role);
      const { id } = idParamsSchema.parse(request.params);
      const input = generateRunSchema.parse(request.body);
      const run = await fastify.prisma.payrollRun.findFirst({ where: { id, tenantId: request.tenant.id } });
      if (!run) throw new PayrollError("Payroll run not found", 404);
      if (run.status !== PayrollStatus.DRAFT) throw new PayrollError("Only draft payroll runs can be regenerated", 409);

      const { start, endExclusive, daysInMonth } = periodBounds(run.period);
      const deductionByEmployee = new Map(input.otherDeductions.map((item) => [item.employeeId, item]));
      const generated = await fastify.prisma.$transaction(async (tx) => {
        const employees = await tx.employee.findMany({
          where: { tenantId: request.tenant.id, status: EmployeeStatus.ACTIVE },
          include: {
            attendance: { where: { date: { gte: start, lt: endExclusive } } },
            payAdvances: {
              where: {
                status: PayAdvanceStatus.APPROVED,
                recoveredIn: null,
                requestedAt: { lt: endExclusive },
              },
            },
          },
          orderBy: { name: "asc" },
        });

        await tx.payslipLine.deleteMany({ where: { payrollRunId: run.id } });
        if (employees.length === 0) return [];

        await tx.payslipLine.createMany({
          data: employees.map((employee) => {
            const payroll = calculatePayslip(employee, daysInMonth);
            const otherDeduction = deductionByEmployee.get(employee.id);
            const otherDeductions = otherDeduction?.amount ?? 0;
            const netPay = roundMoney(Math.max(payroll.grossPay + payroll.overtimePay - payroll.advancesDeducted - otherDeductions, 0));

            return {
              payrollRunId: run.id,
              employeeId: employee.id,
              daysWorked: payroll.daysWorked,
              overtimeHours: payroll.overtimeHours,
              grossPay: payroll.grossPay,
              overtimePay: payroll.overtimePay,
              advancesDeducted: payroll.advancesDeducted,
              otherDeductions,
              netPay,
              breakdown: {
                salaryType: employee.salaryType,
                baseSalary: decimalToNumber(employee.baseSalary),
                daysInMonth,
                attendance: payroll.attendanceCounts,
                approvedAdvanceIds: employee.payAdvances.map((advance) => advance.id),
                otherDeductionNote: otherDeduction?.note ?? null,
              },
            };
          }),
        });

        return tx.payslipLine.findMany({
          where: { payrollRunId: run.id },
          include: { employee: true, payrollRun: true },
          orderBy: { employee: { name: "asc" } },
        });
      });

      await writePayrollAudit(fastify, request.tenant.id, request.user.userId, "PAYROLL_RUN_GENERATED", "PAYROLL_RUN", run.id, { period: run.period, lines: generated.length }, request.ip);
      return reply.status(201).send({ run: formatPayrollRun(run), payslips: generated.map(formatPayslipLine) });
    });
  });

  fastify.patch("/api/payroll/runs/:id/status", async (request, reply) => {
    return handlePayroll(reply, async () => {
      ensurePayrollManager(request.user.role);
      const { id } = idParamsSchema.parse(request.params);
      const input = runStatusSchema.parse(request.body);
      const existing = await fastify.prisma.payrollRun.findFirst({ where: { id, tenantId: request.tenant.id } });
      if (!existing) throw new PayrollError("Payroll run not found", 404);
      if (existing.status === PayrollStatus.PAID) throw new PayrollError("Paid payroll runs are locked", 409);

      const run = await fastify.prisma.$transaction(async (tx) => {
        const updated = await tx.payrollRun.update({ where: { id }, data: { status: input.status, runBy: request.user.userId, runAt: new Date() } });
        if (input.status === PayrollStatus.PAID) {
          const lineEmployeeIds = await tx.payslipLine.findMany({
            where: { payrollRunId: id, advancesDeducted: { gt: 0 } },
            select: { employeeId: true },
          });
          const { endExclusive } = periodBounds(existing.period);
          if (lineEmployeeIds.length > 0) {
            await tx.payAdvance.updateMany({
              where: {
                employeeId: { in: lineEmployeeIds.map((line) => line.employeeId) },
                status: PayAdvanceStatus.APPROVED,
                recoveredIn: null,
                requestedAt: { lt: endExclusive },
              },
              data: { status: PayAdvanceStatus.RECOVERED, recoveredIn: id },
            });
          }
        }

        return updated;
      });
      await writePayrollAudit(fastify, request.tenant.id, request.user.userId, "PAYROLL_RUN_STATUS_UPDATED", "PAYROLL_RUN", id, input, request.ip);
      return formatPayrollRun(run);
    });
  });

  fastify.post("/api/payroll/runs/:id/disburse", async (request, reply) => {
    return handlePayroll(reply, async () => {
      ensurePayrollManager(request.user.role);
      const { id } = idParamsSchema.parse(request.params);
      const input = disburseRunSchema.parse(request.body);
      const paymentMethod = await fastify.prisma.paymentMethod.findFirst({
        where: { id: input.paymentMethodId, tenantId: request.tenant.id, isActive: true, deletedAt: null },
      });
      if (!paymentMethod) throw new PayrollError("Payment method not found or inactive", 400);
      if (paymentMethod.allowedRoles.length > 0 && !paymentMethod.allowedRoles.includes(request.user.role)) {
        throw new PayrollError(`Payment method "${paymentMethod.name}" is not available for your role`, 403);
      }
      if (paymentMethod.requiresReference && !input.referencePrefix) {
        throw new PayrollError(`Reference required for ${paymentMethod.name}`, 400);
      }

      const run = await fastify.prisma.payrollRun.findFirst({
        where: { id, tenantId: request.tenant.id },
        include: {
          payslipLines: {
            include: { employee: true, disbursement: true },
            orderBy: { employee: { name: "asc" } },
          },
        },
      });
      if (!run) throw new PayrollError("Payroll run not found", 404);
      if (run.status === PayrollStatus.DRAFT) throw new PayrollError("Approve payroll before disbursement", 409);

      const allowedLineIds = input.payslipLineIds ? new Set(input.payslipLineIds) : null;
      const lines = run.payslipLines.filter((line) => !line.disbursement && decimalToNumber(line.netPay) > 0 && (!allowedLineIds || allowedLineIds.has(line.id)));
      if (lines.length === 0) throw new PayrollError("No unpaid payslips found for this run", 409);
      const paidAt = input.paidAt ?? new Date();

      const disbursements = await fastify.prisma.$transaction(async (tx) => {
        await tx.payrollDisbursement.createMany({
          data: lines.map((line) => ({
            tenantId: request.tenant.id,
            payrollRunId: run.id,
            payslipLineId: line.id,
            employeeId: line.employeeId,
            paymentMethodId: paymentMethod.id,
            amount: line.netPay,
            paidAt,
            paidById: request.user.userId,
            referenceNumber: input.referencePrefix ? `${input.referencePrefix}-${run.period}-${line.employee.name.replace(/\s+/g, "-").toUpperCase()}`.slice(0, 128) : null,
          })),
        });
        await tx.payrollRun.update({ where: { id: run.id }, data: { status: PayrollStatus.PAID, runBy: request.user.userId, runAt: new Date() } });
        const { endExclusive } = periodBounds(run.period);
        await tx.payAdvance.updateMany({
          where: {
            employeeId: { in: lines.map((line) => line.employeeId) },
            status: PayAdvanceStatus.APPROVED,
            recoveredIn: null,
            requestedAt: { lt: endExclusive },
          },
          data: { status: PayAdvanceStatus.RECOVERED, recoveredIn: run.id },
        });
        return tx.payrollDisbursement.findMany({
          where: { payrollRunId: run.id, payslipLineId: { in: lines.map((line) => line.id) } },
          include: disbursementInclude,
          orderBy: [{ paidAt: "desc" }, { employee: { name: "asc" } }],
        });
      });

      await writePayrollAudit(fastify, request.tenant.id, request.user.userId, "PAYROLL_DISBURSED", "PAYROLL_RUN", run.id, {
        paymentMethodId: paymentMethod.id,
        count: disbursements.length,
        total: roundMoney(disbursements.reduce((sum, item) => sum + decimalToNumber(item.amount), 0)),
      }, request.ip);
      return reply.status(201).send({ data: disbursements.map(formatPayrollDisbursement) });
    });
  });

  fastify.get("/api/payroll/disbursements", async (request) => {
    const query = z.object({
      payrollRunId: z.string().min(1).optional(),
      employeeId: z.string().min(1).optional(),
      paymentMethodId: z.string().min(1).optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(50),
    }).parse(request.query);
    const where = {
      tenantId: request.tenant.id,
      ...(query.payrollRunId ? { payrollRunId: query.payrollRunId } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.paymentMethodId ? { paymentMethodId: query.paymentMethodId } : {}),
    };
    const [total, disbursements] = await Promise.all([
      fastify.prisma.payrollDisbursement.count({ where }),
      fastify.prisma.payrollDisbursement.findMany({
        where,
        include: disbursementInclude,
        orderBy: [{ paidAt: "desc" }, { employee: { name: "asc" } }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return { data: disbursements.map(formatPayrollDisbursement), page: query.page, limit: query.limit, total };
  });

  fastify.post("/api/payroll/disbursements/:id/void", async (request, reply) => {
    return handlePayroll(reply, async () => {
      ensurePayrollManager(request.user.role);
      const { id } = idParamsSchema.parse(request.params);
      const input = disbursementVoidSchema.parse(request.body);
      const existing = await fastify.prisma.payrollDisbursement.findFirst({ where: { id, tenantId: request.tenant.id } });
      if (!existing) throw new PayrollError("Payroll disbursement not found", 404);
      if (existing.voidedAt) throw new PayrollError("Payroll disbursement already voided", 409);
      const disbursement = await fastify.prisma.payrollDisbursement.update({
        where: { id },
        data: { voidedAt: new Date(), voidReason: input.reason, voidAuthorisedById: request.user.userId },
        include: disbursementInclude,
      });
      await writePayrollAudit(fastify, request.tenant.id, request.user.userId, "PAYROLL_DISBURSEMENT_VOIDED", "PAYROLL_DISBURSEMENT", id, input, request.ip);
      return formatPayrollDisbursement(disbursement);
    });
  });

  fastify.get("/api/payroll/payslips", async (request) => {
    const query = z.object({
      payrollRunId: z.string().min(1).optional(),
      employeeId: z.string().min(1).optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(50),
    }).parse(request.query);
    const where = {
      ...(query.payrollRunId ? { payrollRunId: query.payrollRunId } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      payrollRun: { tenantId: request.tenant.id },
    };
    const [total, lines] = await Promise.all([
      fastify.prisma.payslipLine.count({ where }),
      fastify.prisma.payslipLine.findMany({
        where,
        include: { employee: true, payrollRun: true },
        orderBy: [{ payrollRun: { period: "desc" } }, { employee: { name: "asc" } }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return { data: lines.map(formatPayslipLine), page: query.page, limit: query.limit, total };
  });

  fastify.patch("/api/payroll/payslips/:id", async (request, reply) => {
    return handlePayroll(reply, async () => {
      ensurePayrollManager(request.user.role);
      const { id } = idParamsSchema.parse(request.params);
      const input = payslipUpdateSchema.parse(request.body);
      const existing = await fastify.prisma.payslipLine.findFirst({
        where: { id, payrollRun: { tenantId: request.tenant.id } },
        include: { payrollRun: true },
      });
      if (!existing) throw new PayrollError("Payslip not found", 404);
      if (existing.payrollRun.status !== PayrollStatus.DRAFT) throw new PayrollError("Only draft payslips can be edited", 409);

      const currentGross = decimalToNumber(existing.grossPay) + decimalToNumber(existing.overtimePay);
      const currentAdvances = decimalToNumber(existing.advancesDeducted);
      const nextOtherDeductions = input.otherDeductions ?? decimalToNumber(existing.otherDeductions);
      const line = await fastify.prisma.payslipLine.update({
        where: { id },
        data: {
          ...(input.otherDeductions !== undefined
            ? {
                otherDeductions: input.otherDeductions,
                netPay: roundMoney(Math.max(currentGross - currentAdvances - nextOtherDeductions, 0)),
              }
            : {}),
          ...(input.breakdown !== undefined ? { breakdown: input.breakdown as Prisma.InputJsonValue } : {}),
        },
        include: { employee: true, payrollRun: true },
      });
      return formatPayslipLine(line);
    });
  });

  done();
};

function ensurePayrollManager(role: UserRole) {
  if (role !== UserRole.OWNER && role !== UserRole.MANAGER) {
    throw new PayrollError("Only owners and managers can manage payroll", 403);
  }
}

async function handlePayroll<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof PayrollError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    throw error;
  }
}

async function getEmployeeOrThrow(fastify: FastifyInstance, tenantId: string, employeeId: string) {
  const employee = await fastify.prisma.employee.findFirst({ where: { id: employeeId, tenantId } });
  if (!employee) throw new PayrollError("Employee not found", 404);
  return employee;
}

async function getPayrollRunOrThrow(fastify: FastifyInstance, tenantId: string, runId: string) {
  const run = await fastify.prisma.payrollRun.findFirst({
    where: { id: runId, tenantId },
    include: {
      payslipLines: { include: { employee: true }, orderBy: { employee: { name: "asc" } } },
      recoveredAdvances: { include: { employee: { select: { id: true, name: true, department: true } } } },
      disbursements: { include: disbursementInclude, orderBy: [{ paidAt: "desc" }, { employee: { name: "asc" } }] },
    },
  });
  if (!run) throw new PayrollError("Payroll run not found", 404);
  return run;
}

function calculatePayslip(employee: {
  baseSalary: { toNumber(): number };
  salaryType: SalaryType;
  attendance: Array<{ status: AttendanceStatus; overtimeMinutes: number }>;
  payAdvances: Array<{ amount: { toNumber(): number } }>;
}, daysInMonth: number) {
  const attendanceCounts = {
    present: 0,
    absent: 0,
    halfDay: 0,
    leave: 0,
    onDuty: 0,
  };
  let daysWorked = 0;
  let overtimeMinutes = 0;

  for (const row of employee.attendance) {
    overtimeMinutes += row.overtimeMinutes;
    if (row.status === AttendanceStatus.PRESENT) {
      attendanceCounts.present += 1;
      daysWorked += 1;
    } else if (row.status === AttendanceStatus.ON_DUTY) {
      attendanceCounts.onDuty += 1;
      daysWorked += 1;
    } else if (row.status === AttendanceStatus.HALF_DAY) {
      attendanceCounts.halfDay += 1;
      daysWorked += 0.5;
    } else if (row.status === AttendanceStatus.LEAVE) {
      attendanceCounts.leave += 1;
    } else {
      attendanceCounts.absent += 1;
    }
  }

  const baseSalary = decimalToNumber(employee.baseSalary);
  const overtimeHours = roundQuantity(overtimeMinutes / 60);
  const hourlyRate = employee.salaryType === SalaryType.MONTHLY
    ? baseSalary / (daysInMonth * 8)
    : employee.salaryType === SalaryType.DAILY
      ? baseSalary / 8
      : baseSalary;
  const grossPay = employee.salaryType === SalaryType.MONTHLY
    ? roundMoney(baseSalary * (daysWorked / daysInMonth))
    : employee.salaryType === SalaryType.DAILY
      ? roundMoney(baseSalary * daysWorked)
      : roundMoney(baseSalary * daysWorked * 8);
  const overtimePay = roundMoney(hourlyRate * overtimeHours);
  const advancesDeducted = roundMoney(employee.payAdvances.reduce((sum, advance) => sum + decimalToNumber(advance.amount), 0));

  return {
    attendanceCounts,
    daysWorked: roundQuantity(daysWorked),
    overtimeHours,
    grossPay,
    overtimePay,
    advancesDeducted,
  };
}

function periodBounds(period: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) throw new PayrollError("Payroll period must use YYYY-MM", 400);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const endExclusive = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start, endExclusive, daysInMonth };
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function timeToDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.length === 5 ? `${value}:00` : value;
  return new Date(`1970-01-01T${normalized}.000Z`);
}

function formatTime(value: Date | null | undefined): string | null {
  if (!value) return null;
  return [value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function decimalToNumber(value: { toNumber(): number } | number): number {
  return typeof value === "number" ? value : value.toNumber();
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

type EmployeeForResponse = {
  id: string;
  name: string;
  phone: string;
  role: string;
  department: string;
  baseSalary: { toNumber(): number };
  salaryType: SalaryType;
  status: EmployeeStatus;
  joinedAt: Date;
  createdAt: Date;
  _count?: { attendance: number; payAdvances: number; payslipLines: number };
};

type AttendanceForResponse = {
  id: string;
  employeeId: string;
  date: Date;
  status: AttendanceStatus;
  shiftStart: Date | null;
  shiftEnd: Date | null;
  overtimeMinutes: number;
  note: string | null;
  employee?: { id: string; name: string; department: string };
};

type PayAdvanceForResponse = {
  id: string;
  employeeId: string;
  amount: { toNumber(): number };
  reason: string | null;
  status: PayAdvanceStatus;
  requestedAt: Date;
  approvedAt: Date | null;
  approvedBy: string | null;
  recoveredIn: string | null;
  employee?: { id: string; name: string; department: string };
  recoveredInRun?: { id: string; period: string } | null;
};

type PayrollRunForResponse = {
  id: string;
  period: string;
  runAt: Date;
  status: PayrollStatus;
  runBy: string | null;
  notes: string | null;
  _count?: { payslipLines: number; recoveredAdvances: number };
};

type PayslipLineForResponse = {
  id: string;
  payrollRunId: string;
  employeeId: string;
  daysWorked: { toNumber(): number };
  overtimeHours: { toNumber(): number };
  grossPay: { toNumber(): number };
  overtimePay: { toNumber(): number };
  advancesDeducted: { toNumber(): number };
  otherDeductions: { toNumber(): number };
  netPay: { toNumber(): number };
  breakdown: Prisma.JsonValue;
  employee?: { id: string; name: string; department: string; role?: string };
  payrollRun?: { id: string; period: string; status: PayrollStatus };
};

type PayrollDisbursementForResponse = {
  id: string;
  payrollRunId: string;
  payslipLineId: string;
  employeeId: string;
  paymentMethodId: string;
  amount: { toNumber(): number };
  referenceNumber: string | null;
  paidAt: Date;
  paidById: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  employee?: { id: string; name: string; department: string };
  payrollRun?: { id: string; period: string; status: PayrollStatus };
  paymentMethod?: { id: string; name: string; shortCode: string; color: string };
  paidBy?: { name: string } | null;
  voidAuthorisedBy?: { name: string } | null;
};

type PayrollRunDetailForResponse = PayrollRunForResponse & {
  payslipLines: PayslipLineForResponse[];
  recoveredAdvances: PayAdvanceForResponse[];
  disbursements?: PayrollDisbursementForResponse[];
};

function formatEmployee(employee: EmployeeForResponse) {
  return {
    id: employee.id,
    name: employee.name,
    phone: employee.phone,
    role: employee.role,
    department: employee.department,
    baseSalary: decimalToNumber(employee.baseSalary),
    salaryType: employee.salaryType,
    status: employee.status,
    joinedAt: employee.joinedAt.toISOString().slice(0, 10),
    createdAt: employee.createdAt.toISOString(),
    counts: employee._count,
  };
}

function formatAttendance(attendance: AttendanceForResponse) {
  return {
    id: attendance.id,
    employeeId: attendance.employeeId,
    employee: attendance.employee,
    date: attendance.date.toISOString().slice(0, 10),
    status: attendance.status,
    shiftStart: formatTime(attendance.shiftStart),
    shiftEnd: formatTime(attendance.shiftEnd),
    overtimeMinutes: attendance.overtimeMinutes,
    note: attendance.note,
  };
}

function formatPayAdvance(advance: PayAdvanceForResponse) {
  return {
    id: advance.id,
    employeeId: advance.employeeId,
    employee: advance.employee,
    amount: decimalToNumber(advance.amount),
    reason: advance.reason,
    status: advance.status,
    requestedAt: advance.requestedAt.toISOString(),
    approvedAt: advance.approvedAt?.toISOString() ?? null,
    approvedBy: advance.approvedBy,
    recoveredIn: advance.recoveredIn,
    recoveredInRun: advance.recoveredInRun ? { id: advance.recoveredInRun.id, period: advance.recoveredInRun.period } : null,
  };
}

function formatPayrollRun(run: PayrollRunForResponse) {
  return {
    id: run.id,
    period: run.period,
    runAt: run.runAt.toISOString(),
    status: run.status,
    runBy: run.runBy,
    notes: run.notes,
    counts: run._count,
  };
}

function formatPayrollRunDetail(run: PayrollRunDetailForResponse) {
  return {
    ...formatPayrollRun(run),
    payslips: run.payslipLines.map(formatPayslipLine),
    recoveredAdvances: run.recoveredAdvances.map(formatPayAdvance),
    disbursements: run.disbursements?.map(formatPayrollDisbursement) ?? [],
  };
}

function formatPayslipLine(line: PayslipLineForResponse) {
  return {
    id: line.id,
    payrollRunId: line.payrollRunId,
    employeeId: line.employeeId,
    employee: line.employee,
    payrollRun: line.payrollRun ? { id: line.payrollRun.id, period: line.payrollRun.period, status: line.payrollRun.status } : undefined,
    daysWorked: decimalToNumber(line.daysWorked),
    overtimeHours: decimalToNumber(line.overtimeHours),
    grossPay: decimalToNumber(line.grossPay),
    overtimePay: decimalToNumber(line.overtimePay),
    advancesDeducted: decimalToNumber(line.advancesDeducted),
    otherDeductions: decimalToNumber(line.otherDeductions),
    netPay: decimalToNumber(line.netPay),
    breakdown: line.breakdown,
  };
}

function formatPayrollDisbursement(disbursement: PayrollDisbursementForResponse) {
  return {
    id: disbursement.id,
    payrollRunId: disbursement.payrollRunId,
    payslipLineId: disbursement.payslipLineId,
    employeeId: disbursement.employeeId,
    employee: disbursement.employee,
    payrollRun: disbursement.payrollRun ? { id: disbursement.payrollRun.id, period: disbursement.payrollRun.period, status: disbursement.payrollRun.status } : undefined,
    paymentMethodId: disbursement.paymentMethodId,
    paymentMethod: disbursement.paymentMethod ? {
      id: disbursement.paymentMethod.id,
      name: disbursement.paymentMethod.name,
      short_code: disbursement.paymentMethod.shortCode,
      color: disbursement.paymentMethod.color,
    } : undefined,
    amount: decimalToNumber(disbursement.amount),
    referenceNumber: disbursement.referenceNumber,
    paidAt: disbursement.paidAt.toISOString(),
    paidBy: disbursement.paidBy?.name ?? null,
    voidedAt: disbursement.voidedAt?.toISOString() ?? null,
    voidReason: disbursement.voidReason,
    voidAuthorisedBy: disbursement.voidAuthorisedBy?.name ?? null,
  };
}

async function writePayrollAudit(
  fastify: FastifyInstance,
  tenantId: string,
  userId: string,
  action: string,
  entity: string,
  entityId: string,
  changes: object,
  ip: string,
) {
  await fastify.prisma.auditLog.create({
    data: {
      tenantId,
      userId,
      action,
      entity,
      entityId,
      changes: toAuditChanges(changes),
      ip,
    },
  });
}

function toAuditChanges(changes: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(changes)) as Prisma.InputJsonValue;
}
