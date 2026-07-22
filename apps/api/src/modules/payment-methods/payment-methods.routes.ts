import { InvoiceStatus, PaymentMethodType, PaymentMode, SettlementStatus, UserRole } from "@prisma/client";
import type { FastifyPluginCallback } from "fastify";
import QRCode from "qrcode";
import { z } from "zod";

const paymentMethodTypeSchema = z.preprocess((value) => upperString(value, "CUSTOM"), z.nativeEnum(PaymentMethodType));
const settlementStatusSchema = z.preprocess((value) => upperString(value, ""), z.nativeEnum(SettlementStatus));
const roleListSchema = z.array(z.string().trim().transform((role) => role.toUpperCase())).default([]);
const keyboardShortcutSchema = z.preprocess(
  (value) => typeof value === "string" ? normalizeKeyboardShortcut(value) : value,
  z.string().regex(/^(?:Ctrl\+[1-9]|F2|F4|F8|F9)$/).nullable(),
);

const queryBooleanSchema = z.preprocess((value) => {
  if (value === undefined) return false;
  if (typeof value === "string") return ["1", "true", "yes"].includes(value.toLowerCase());
  return value;
}, z.boolean()).default(false);

const methodQuerySchema = z.object({
  includeInactive: queryBooleanSchema,
  storeId: z.string().min(1).optional(),
});

const methodPayloadSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  short_code: z.string().trim().min(1).max(12).transform((value) => value.toUpperCase()).optional(),
  type: paymentMethodTypeSchema.optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().trim().min(1).max(64).optional(),
  keyboard_shortcut: keyboardShortcutSchema.optional(),
  display_order: z.coerce.number().int().min(1).optional(),
  is_active: z.boolean().optional(),
  requires_reference: z.boolean().optional(),
  reference_label: z.string().trim().max(64).nullable().optional(),
  allows_split: z.boolean().optional(),
  upi_id: z.string().trim().max(128).nullable().optional(),
  partner_id: z.string().trim().min(1).nullable().optional(),
  opening_balance: z.coerce.number().finite().optional(),
  settlement_frequency: z.preprocess((value) => value === null || value === "" || value === undefined ? null : upperString(value, ""), z.enum(["DAILY", "WEEKLY", "MONTHLY"]).nullable()).optional(),
  allowed_roles: roleListSchema.optional(),
  storeId: z.string().min(1).optional(),
});

const createMethodSchema = methodPayloadSchema.extend({
  name: z.string().trim().min(1).max(64),
  short_code: z.string().trim().min(1).max(12).transform((value) => value.toUpperCase()),
});

const idParamsSchema = z.object({ id: z.string().min(1) });
const reorderSchema = z.array(z.object({
  id: z.string().min(1),
  display_order: z.coerce.number().int().min(1),
}));
const invoicePaymentsParamsSchema = z.object({ id: z.string().min(1) });
const invoicePaymentsSchema = z.object({
  payments: z.array(z.object({
    payment_method_id: z.string().min(1),
    amount: z.coerce.number().positive(),
    reference_number: z.string().trim().max(128).optional(),
  })).min(1),
});
const voidSchema = z.object({ reason: z.string().trim().min(3) });
const statementQuerySchema = z.object({
  payment_method_id: z.string().min(1),
  date_from: z.coerce.date(),
  date_to: z.coerce.date(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});
const summaryQuerySchema = z.object({
  date_from: z.coerce.date(),
  date_to: z.coerce.date(),
  storeId: z.string().min(1).optional(),
});
const partnerPayloadSchema = z.object({
  name: z.string().trim().min(1).max(128),
  contact_name: z.string().trim().max(128).nullable().optional(),
  contact_phone: z.string().trim().max(32).nullable().optional(),
  contact_email: z.string().trim().max(128).nullable().optional(),
  settlement_terms: z.string().trim().nullable().optional(),
  storeId: z.string().min(1).optional(),
});
const settlementCreateSchema = z.object({
  payment_method_id: z.string().min(1),
  period_start: z.coerce.date(),
  period_end: z.coerce.date(),
  notes: z.string().trim().nullable().optional(),
});
const settlementsQuerySchema = z.object({
  partner_id: z.string().min(1).optional(),
  payment_method_id: z.string().min(1).optional(),
});
const settlementStatusUpdateSchema = z.object({
  status: settlementStatusSchema.refine((status) => status !== SettlementStatus.DRAFT, "Status must be REVIEWED or SETTLED"),
});

interface StatementRow {
  id: string;
  recorded_at: Date;
  invoice_number: string;
  customer_name: string;
  cashier_name: string;
  amount: unknown;
  reference_number: string | null;
  type: "sale" | "void";
  void_reason: string | null;
  running_balance: unknown;
}

export const paymentMethodsRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/payment-methods", async (request) => {
    const query = methodQuerySchema.parse(request.query);
    const storeId = await resolveStoreId(request.tenant.id, query.storeId ?? request.storeId ?? undefined);
    const methods = await fastify.prisma.paymentMethod.findMany({
      where: {
        tenantId: request.tenant.id,
        storeId,
        ...(query.includeInactive ? {} : { isActive: true, deletedAt: null }),
      },
      include: { partner: true, _count: { select: { payments: true } } },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    });
    return methods.map(formatMethod);
  });

  fastify.post("/api/payment-methods", async (request, reply) => {
    ensureManager(request.user.role);
    const input = createMethodSchema.parse(request.body);
    const store = await getStore(request.tenant.id, input.storeId ?? request.storeId ?? undefined);
    const type = input.type ?? PaymentMethodType.CUSTOM;
    const upiQrData = type === PaymentMethodType.UPI ? await buildQrOrThrow(input.upi_id, request.tenant.name) : null;
    const method = await fastify.prisma.paymentMethod.create({
      data: {
        tenantId: request.tenant.id,
        storeId: store.id,
        name: input.name,
        shortCode: input.short_code,
        type,
        color: input.color ?? defaultColor(type),
        icon: input.icon ?? defaultIcon(type),
        keyboardShortcut: input.keyboard_shortcut ?? null,
        displayOrder: input.display_order ?? 100,
        requiresReference: input.requires_reference ?? false,
        referenceLabel: input.reference_label ?? null,
        allowsSplit: input.allows_split ?? true,
        upiId: input.upi_id ?? null,
        upiQrData,
        partnerId: input.partner_id ?? null,
        openingBalance: input.opening_balance ?? 0,
        settlementFrequency: input.settlement_frequency ?? null,
        allowedRoles: input.allowed_roles ?? [],
      },
      include: { partner: true, _count: { select: { payments: true } } },
    });
    return reply.status(201).send(formatMethod(method));
  });

  fastify.patch("/api/payment-methods/reorder", async (request) => {
    ensureManager(request.user.role);
    const input = reorderSchema.parse(request.body);
    const ids = input.map((item) => item.id);
    const methods = await fastify.prisma.paymentMethod.findMany({
      where: { tenantId: request.tenant.id, id: { in: ids } },
      orderBy: { displayOrder: "asc" },
    });
    const methodById = new Map(methods.map((method) => [method.id, method]));
    const orderedMethods = input.map((item) => {
      const method = methodById.get(item.id);
      if (!method) throw new Error("Payment method not found");
      return method;
    });
    await fastify.prisma.$transaction(input.map((item, index) => {
      const method = methodById.get(item.id);
      if (!method) throw new Error("Payment method not found");
      return fastify.prisma.paymentMethod.update({
        where: { id: item.id },
        data: {
          displayOrder: item.display_order,
          keyboardShortcut: method.isDefault ? defaultKeyboardShortcut(method.type) : customShortcutForIndex(index, orderedMethods),
        },
      });
    }));
    return { status: "ok" };
  });

  fastify.patch("/api/payment-methods/:id", async (request) => {
    ensureManager(request.user.role);
    const { id } = idParamsSchema.parse(request.params);
    const input = methodPayloadSchema.parse(request.body);
    const existing = await getPaymentMethod(request.tenant.id, id);
    if (existing.isDefault && (input.short_code || input.type)) {
      throw statusError("Default methods cannot change type or short code", 403);
    }
    const nextType = input.type ?? existing.type;
    const keyboardShortcutUpdate = existing.isDefault
      ? { keyboardShortcut: defaultKeyboardShortcut(existing.type) }
      : input.keyboard_shortcut !== undefined
        ? { keyboardShortcut: input.keyboard_shortcut }
        : {};
    const nextUpiId = input.upi_id !== undefined ? input.upi_id : existing.upiId;
    const upiQrData = nextType === PaymentMethodType.UPI && input.upi_id !== undefined
      ? await buildQrOrThrow(nextUpiId, request.tenant.name)
      : undefined;
    const method = await fastify.prisma.paymentMethod.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.short_code !== undefined ? { shortCode: input.short_code } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...keyboardShortcutUpdate,
        ...(input.display_order !== undefined ? { displayOrder: input.display_order } : {}),
        ...(input.is_active !== undefined ? { isActive: input.is_active } : {}),
        ...(input.requires_reference !== undefined ? { requiresReference: input.requires_reference } : {}),
        ...(input.reference_label !== undefined ? { referenceLabel: input.reference_label } : {}),
        ...(input.allows_split !== undefined ? { allowsSplit: input.allows_split } : {}),
        ...(input.upi_id !== undefined ? { upiId: input.upi_id } : {}),
        ...(upiQrData !== undefined ? { upiQrData } : {}),
        ...(input.partner_id !== undefined ? { partnerId: input.partner_id } : {}),
        ...(input.opening_balance !== undefined ? { openingBalance: input.opening_balance } : {}),
        ...(input.settlement_frequency !== undefined ? { settlementFrequency: input.settlement_frequency } : {}),
        ...(input.allowed_roles !== undefined ? { allowedRoles: input.allowed_roles } : {}),
        ...(input.is_active === true ? { deletedAt: null } : {}),
      },
      include: { partner: true, _count: { select: { payments: true } } },
    });
    return formatMethod(method);
  });

  fastify.delete("/api/payment-methods/:id", async (request) => {
    ensureManager(request.user.role);
    const { id } = idParamsSchema.parse(request.params);
    const method = await getPaymentMethod(request.tenant.id, id);
    const transactionCount = await fastify.prisma.payment.count({ where: { paymentMethodId: id } });
    if (method.isDefault && method.type === PaymentMethodType.CASH) throw statusError("Cash cannot be deleted", 403);
    if (transactionCount > 0 || method.isDefault) {
      await fastify.prisma.paymentMethod.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } });
      return { deleted: true, type: "soft" };
    }
    await fastify.prisma.paymentMethod.delete({ where: { id } });
    return { deleted: true, type: "hard" };
  });

  fastify.get("/api/payment-methods/:id/qr", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const method = await getPaymentMethod(request.tenant.id, id);
    if (!method.upiQrData) throw statusError("QR code not available", 404);
    const [, base64] = method.upiQrData.split(",");
    return reply.header("Content-Type", "image/png").send(Buffer.from(base64 ?? method.upiQrData, "base64"));
  });

  fastify.post("/api/payment-methods/:id/regenerate-qr", async (request) => {
    ensureManager(request.user.role);
    const { id } = idParamsSchema.parse(request.params);
    const method = await getPaymentMethod(request.tenant.id, id);
    const upiQrData = await buildQrOrThrow(method.upiId, request.tenant.name);
    return formatMethod(await fastify.prisma.paymentMethod.update({
      where: { id },
      data: { upiQrData },
      include: { partner: true, _count: { select: { payments: true } } },
    }));
  });

  fastify.post("/api/invoices/:id/payments", async (request, reply) => {
    const { id } = invoicePaymentsParamsSchema.parse(request.params);
    const input = invoicePaymentsSchema.parse(request.body);
    const invoice = await fastify.prisma.invoice.findFirst({ where: { tenantId: request.tenant.id, id }, include: { customer: true } });
    if (!invoice) throw statusError("Invoice not found", 404);
    const methodIds = input.payments.map((payment) => payment.payment_method_id);
    const methods = await fastify.prisma.paymentMethod.findMany({
      where: { tenantId: request.tenant.id, id: { in: methodIds }, isActive: true, deletedAt: null },
    });
    const methodById = new Map(methods.map((method) => [method.id, method]));
    const total = roundMoney(input.payments.reduce((sum, payment) => sum + payment.amount, 0));
    if (Math.abs(total - invoice.grandTotal.toNumber()) > 0.01) throw statusError("Payment total must match invoice total", 400);
    const firstPayment = input.payments[0];
    if (!firstPayment) throw statusError("At least one payment is required", 400);
    for (const leg of input.payments) {
      const method = methodById.get(leg.payment_method_id);
      if (!method) throw statusError("Payment method not found or inactive", 400);
      if (method.requiresReference && !leg.reference_number) throw statusError(`Reference required for ${method.name}`, 400);
      if (method.allowedRoles.length > 0 && !method.allowedRoles.includes(request.user.role)) throw statusError(`Payment method "${method.name}" is not available for your role`, 403);
    }
    const result = await fastify.prisma.$transaction(async (tx) => {
      await tx.payment.createMany({
        data: input.payments.map((leg) => {
          const mode = legacyMode(methodById.get(leg.payment_method_id)?.type);
          return {
            tenantId: request.tenant.id,
            invoiceId: id,
            paymentMethodId: leg.payment_method_id,
            amount: leg.amount,
            cashierId: request.user.userId,
            ...(mode ? { mode } : {}),
            ...(leg.reference_number ? { referenceNumber: leg.reference_number } : {}),
          };
        }),
      });
      const creditTotal = input.payments
        .filter((leg) => methodById.get(leg.payment_method_id)?.type === PaymentMethodType.CREDIT)
        .reduce((sum, leg) => sum + leg.amount, 0);
      if (creditTotal > 0 && invoice.customerId) {
        await tx.customer.update({ where: { id: invoice.customerId }, data: { outstandingDue: { increment: creditTotal } } });
      }
      return tx.invoice.update({
        where: { id },
        data: {
          amountPaid: total,
          amountDue: 0,
          status: InvoiceStatus.PAID,
          paymentMethodId: firstPayment.payment_method_id,
          paymentMode: legacyMode(methodById.get(firstPayment.payment_method_id)?.type) ?? PaymentMode.CASH,
        },
        include: { payments: { include: { paymentMethod: true } } },
      });
    });
    return reply.status(201).send(result);
  });

  fastify.post("/api/invoice-payments/:id/void", async (request) => {
    ensureManager(request.user.role);
    const { id } = idParamsSchema.parse(request.params);
    const input = voidSchema.parse(request.body);
    const payment = await fastify.prisma.payment.findFirst({ where: { id, tenantId: request.tenant.id }, include: { invoice: true } });
    if (!payment) throw statusError("Payment not found", 404);
    if (payment.voidedAt) throw statusError("Payment is already voided", 409);
    return fastify.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id },
        data: { voidedAt: new Date(), voidReason: input.reason, voidAuthorisedById: request.user.userId },
      });
      const remaining = await tx.payment.aggregate({
        where: { tenantId: request.tenant.id, invoiceId: payment.invoiceId, voidedAt: null },
        _sum: { amount: true },
      });
      const amountPaid = remaining._sum.amount?.toNumber() ?? 0;
      const amountDue = Math.max(payment.invoice.grandTotal.toNumber() - amountPaid, 0);
      return tx.invoice.update({
        where: { id: payment.invoiceId },
        data: {
          amountPaid,
          amountDue,
          status: amountDue <= 0.01 ? InvoiceStatus.PAID : amountPaid > 0 ? InvoiceStatus.PARTIAL : InvoiceStatus.CONFIRMED,
        },
        include: { payments: { include: { paymentMethod: true } } },
      });
    });
  });

  fastify.get("/api/reports/payment-methods-summary", async (request) => {
    const query = summaryQuerySchema.parse(request.query);
    const storeId = await resolveStoreId(request.tenant.id, query.storeId ?? request.storeId ?? undefined);
    const methods = await fastify.prisma.paymentMethod.findMany({
      where: { tenantId: request.tenant.id, storeId, isActive: true, deletedAt: null },
      include: { payments: { where: { recordedAt: { gte: startOfDay(query.date_from), lte: endOfDay(query.date_to) } } } },
      orderBy: { displayOrder: "asc" },
    });
    return methods.map((method) => {
      const activePayments = method.payments.filter((payment) => !payment.voidedAt);
      const voidPayments = method.payments.filter((payment) => payment.voidedAt);
      return {
        id: method.id,
        name: method.name,
        short_code: method.shortCode,
        color: method.color,
        type: method.type.toLowerCase(),
        total_sales: roundMoney(activePayments.reduce((sum, payment) => sum + payment.amount.toNumber(), 0)),
        transaction_count: activePayments.length,
        void_count: voidPayments.length,
      };
    });
  });

  fastify.get("/api/reports/payment-method-statement", async (request) => {
    const query = statementQuerySchema.parse(request.query);
    const method = await getPaymentMethod(request.tenant.id, query.payment_method_id);
    const where = {
      tenantId: request.tenant.id,
      paymentMethodId: method.id,
      recordedAt: { gte: startOfDay(query.date_from), lte: endOfDay(query.date_to) },
    };
    const offset = (query.page - 1) * query.per_page;
    const [total, activeCount, totalSales, rows] = await Promise.all([
      fastify.prisma.payment.count({ where }),
      fastify.prisma.payment.count({ where: { ...where, voidedAt: null } }),
      fastify.prisma.payment.aggregate({ where: { ...where, voidedAt: null }, _sum: { amount: true } }),
      fastify.prisma.$queryRaw<StatementRow[]>`
        WITH ordered AS (
          SELECT
            ip.id,
            ip.recorded_at,
            i.invoice_number,
            COALESCE(c.name, 'Walk-in') AS customer_name,
            COALESCE(u.name, '') AS cashier_name,
            ip.amount,
            ip.reference_number,
            CASE WHEN ip.voided_at IS NOT NULL THEN 'void' ELSE 'sale' END AS type,
            ip.void_reason,
            (
              ${method.openingBalance.toNumber()}::numeric +
              SUM(
                CASE WHEN ip.voided_at IS NULL THEN ip.amount ELSE 0 END
              ) OVER (
                PARTITION BY ip.payment_method_id
                ORDER BY ip.recorded_at, ip.id
                ROWS UNBOUNDED PRECEDING
              )
            ) AS running_balance
          FROM invoice_payments ip
          JOIN invoices i ON i.id = ip.invoice_id
          LEFT JOIN customers c ON c.id = i.customer_id
          LEFT JOIN users u ON u.id = ip.cashier_id
          WHERE ip.tenant_id = ${request.tenant.id}
            AND ip.payment_method_id = ${method.id}
            AND ip.recorded_at >= ${startOfDay(query.date_from)}
            AND ip.recorded_at <= ${endOfDay(query.date_to)}
        )
        SELECT *
        FROM ordered
        ORDER BY recorded_at, id
        LIMIT ${query.per_page}
        OFFSET ${offset}
      `,
    ]);
    const transactions = rows.map((payment) => {
      const recordedAt = new Date(payment.recorded_at);
      return {
        date: recordedAt.toISOString().slice(0, 10),
        time: recordedAt.toISOString().slice(11, 19),
        invoice_number: payment.invoice_number,
        customer_name: payment.customer_name,
        cashier_name: payment.cashier_name,
        amount: Number(payment.amount),
        reference_number: payment.reference_number,
        type: payment.type,
        void_reason: payment.void_reason,
        running_balance: Number(payment.running_balance),
      };
    });
    const sales = totalSales._sum.amount?.toNumber() ?? 0;
    return {
      method: formatMethod({ ...method, partner: null, _count: { payments: total } }),
      period: { from: query.date_from, to: query.date_to },
      summary: {
        opening_balance: method.openingBalance.toNumber(),
        total_sales: roundMoney(sales),
        total_refunds: 0,
        net_amount: roundMoney(sales),
        transaction_count: activeCount,
        void_count: Math.max(total - activeCount, 0),
      },
      transactions,
      pagination: { total, page: query.page, per_page: query.per_page, total_pages: Math.ceil(total / query.per_page) },
    };
  });

  fastify.get("/api/partners", async (request) => {
    const storeId = await resolveStoreId(request.tenant.id, request.storeId ?? undefined);
    return fastify.prisma.partner.findMany({ where: { tenantId: request.tenant.id, storeId }, orderBy: { name: "asc" } });
  });

  fastify.post("/api/partners", async (request, reply) => {
    ensureManager(request.user.role);
    const input = partnerPayloadSchema.parse(request.body);
    const store = await getStore(request.tenant.id, input.storeId ?? request.storeId ?? undefined);
    const partner = await fastify.prisma.partner.create({
      data: {
        tenantId: request.tenant.id,
        storeId: store.id,
        name: input.name,
        contactName: input.contact_name ?? null,
        contactPhone: input.contact_phone ?? null,
        contactEmail: input.contact_email ?? null,
        settlementTerms: input.settlement_terms ?? null,
      },
    });
    return reply.status(201).send(partner);
  });

  fastify.get("/api/settlements", async (request) => {
    const query = settlementsQuerySchema.parse(request.query);
    const settlements = await fastify.prisma.settlement.findMany({
      where: {
        tenantId: request.tenant.id,
        ...(query.partner_id ? { partnerId: query.partner_id } : {}),
        ...(query.payment_method_id ? { paymentMethodId: query.payment_method_id } : {}),
      },
      include: { paymentMethod: true, partner: true, settledBy: { select: { name: true } } },
      orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
    });
    return settlements.map(formatSettlement);
  });

  fastify.get("/api/reports/partner-settlement", async (request) => {
    const query = z.object({
      partner_id: z.string().min(1),
      period_start: z.coerce.date(),
      period_end: z.coerce.date(),
    }).parse(request.query);
    const methods = await fastify.prisma.paymentMethod.findMany({
      where: { tenantId: request.tenant.id, partnerId: query.partner_id },
      include: {
        payments: {
          where: {
            voidedAt: null,
            recordedAt: { gte: startOfDay(query.period_start), lte: endOfDay(query.period_end) },
          },
        },
        partner: true,
      },
      orderBy: { displayOrder: "asc" },
    });
    return {
      partner: methods[0]?.partner ?? null,
      period: { from: query.period_start, to: query.period_end },
      methods: methods.map((method) => {
        const totalSales = roundMoney(method.payments.reduce((sum, payment) => sum + payment.amount.toNumber(), 0));
        return {
          id: method.id,
          name: method.name,
          short_code: method.shortCode,
          color: method.color,
          total_sales: totalSales,
          total_refunds: 0,
          net_amount: totalSales,
          transaction_count: method.payments.length,
        };
      }),
    };
  });

  fastify.post("/api/settlements", async (request, reply) => {
    ensureManager(request.user.role);
    const input = settlementCreateSchema.parse(request.body);
    const method = await getPaymentMethod(request.tenant.id, input.payment_method_id);
    const payments = await fastify.prisma.payment.findMany({
      where: { tenantId: request.tenant.id, paymentMethodId: method.id, voidedAt: null, recordedAt: { gte: startOfDay(input.period_start), lte: endOfDay(input.period_end) } },
    });
    const totalSales = roundMoney(payments.reduce((sum, payment) => sum + payment.amount.toNumber(), 0));
    const settlement = await fastify.prisma.settlement.create({
      data: {
        tenantId: request.tenant.id,
        paymentMethodId: method.id,
        partnerId: method.partnerId,
        periodStart: input.period_start,
        periodEnd: input.period_end,
        openingBalance: method.openingBalance,
        totalSales,
        totalRefunds: 0,
        netAmount: totalSales,
        notes: input.notes ?? null,
      },
      include: { paymentMethod: true, partner: true, settledBy: { select: { name: true } } },
    });
    return reply.status(201).send(formatSettlement(settlement));
  });

  fastify.patch("/api/settlements/:id/status", async (request) => {
    ensureManager(request.user.role);
    const { id } = idParamsSchema.parse(request.params);
    const input = settlementStatusUpdateSchema.parse(request.body);
    const settlement = await fastify.prisma.settlement.findFirst({ where: { id, tenantId: request.tenant.id } });
    if (!settlement) throw statusError("Settlement not found", 404);
    if (settlement.status === SettlementStatus.SETTLED) throw statusError("Settled records are immutable", 403);
    const updated = await fastify.prisma.settlement.update({
      where: { id },
      data: {
        status: input.status,
        ...(input.status === SettlementStatus.SETTLED ? { settledAt: new Date(), settledById: request.user.userId } : {}),
      },
      include: { paymentMethod: true, partner: true, settledBy: { select: { name: true } } },
    });
    return formatSettlement(updated);
  });

  done();

  async function resolveStoreId(tenantId: string, storeId?: string | null) {
    return (await getStore(tenantId, storeId ?? undefined)).id;
  }

  async function getStore(tenantId: string, storeId?: string) {
    const store = await fastify.prisma.store.findFirst({
      where: {
        tenantId,
        ...(storeId ? { id: storeId } : { isActive: true }),
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    if (!store) throw statusError("Store not found", 404);
    return store;
  }

  async function getPaymentMethod(tenantId: string, id: string) {
    const method = await fastify.prisma.paymentMethod.findFirst({ where: { id, tenantId } });
    if (!method) throw statusError("Payment method not found", 404);
    return method;
  }
};

function upperString(value: unknown, fallback: string): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).toUpperCase();
  }

  return fallback;
}

function ensureManager(role: UserRole) {
  if (role !== UserRole.OWNER && role !== UserRole.MANAGER) {
    throw statusError("Only owners and managers can manage payment methods", 403);
  }
}

function statusError(message: string, statusCode: number) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

async function buildQrOrThrow(upiId: string | null | undefined, storeName: string) {
  if (!upiId || !/^[\w.-]+@[\w.-]+$/.test(upiId)) throw statusError("Valid UPI ID is required for UPI methods", 400);
  const upiString = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(storeName)}&cu=INR`;
  return QRCode.toDataURL(upiString, {
    width: 400,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

function defaultColor(type: PaymentMethodType) {
  if (type === PaymentMethodType.UPI) return "#7f77dd";
  if (type === PaymentMethodType.CARD) return "#378add";
  if (type === PaymentMethodType.CREDIT) return "#854f0b";
  return "#1a6e4a";
}

function defaultIcon(type: PaymentMethodType) {
  if (type === PaymentMethodType.UPI) return "ti-qrcode";
  if (type === PaymentMethodType.CARD) return "ti-credit-card";
  if (type === PaymentMethodType.CREDIT) return "ti-user-dollar";
  return "ti-cash";
}

function defaultKeyboardShortcut(type: PaymentMethodType) {
  if (type === PaymentMethodType.CASH) return "F2";
  if (type === PaymentMethodType.UPI) return "F4";
  if (type === PaymentMethodType.CARD) return "F8";
  if (type === PaymentMethodType.CREDIT) return "F9";
  return null;
}

function customShortcutForIndex(index: number, methods: Array<{ id: string; isDefault: boolean }>) {
  const customIndex = methods.slice(0, index + 1).filter((method) => !method.isDefault).length;
  return customIndex >= 1 && customIndex <= 9 ? `Ctrl+${String(customIndex)}` : null;
}

function normalizeKeyboardShortcut(value: string) {
  const shortcut = value.trim();
  const ctrlMatch = /^ctrl\+([1-9])$/i.exec(shortcut);
  if (ctrlMatch) return `Ctrl+${String(ctrlMatch[1])}`;

  const functionKeyMatch = /^(f[2489])$/i.exec(shortcut);
  if (functionKeyMatch) return (functionKeyMatch[1] ?? shortcut).toUpperCase();

  return shortcut;
}

function legacyMode(type: PaymentMethodType | undefined) {
  if (type === PaymentMethodType.UPI) return PaymentMode.UPI;
  if (type === PaymentMethodType.CARD) return PaymentMode.CARD;
  if (type === PaymentMethodType.CREDIT) return PaymentMode.CREDIT;
  return type === PaymentMethodType.CASH ? PaymentMode.CASH : undefined;
}

function formatMethod(method: {
  id: string;
  name: string;
  shortCode: string;
  type: PaymentMethodType;
  color: string;
  icon: string;
  keyboardShortcut: string | null;
  displayOrder: number;
  isDefault: boolean;
  isActive: boolean;
  requiresReference: boolean;
  referenceLabel: string | null;
  allowsSplit: boolean;
  upiId: string | null;
  upiQrData: string | null;
  partnerId: string | null;
  openingBalance: { toNumber: () => number };
  settlementFrequency: string | null;
  allowedRoles: string[];
  deletedAt: Date | null;
  partner?: unknown;
  _count?: { payments: number };
}) {
  return {
    id: method.id,
    name: method.name,
    short_code: method.shortCode,
    type: method.type.toLowerCase(),
    color: method.color,
    icon: method.icon,
    keyboard_shortcut: method.keyboardShortcut,
    display_order: method.displayOrder,
    is_default: method.isDefault,
    is_active: method.isActive,
    requires_reference: method.requiresReference,
    reference_label: method.referenceLabel,
    allows_split: method.allowsSplit,
    upi_id: method.upiId,
    upi_qr_data: method.upiQrData,
    partner_id: method.partnerId,
    partner: method.partner,
    opening_balance: method.openingBalance.toNumber(),
    settlement_frequency: method.settlementFrequency?.toLowerCase() ?? null,
    allowed_roles: method.allowedRoles,
    deleted_at: method.deletedAt,
    transaction_count: method._count?.payments ?? 0,
  };
}

function formatSettlement(settlement: {
  id: string;
  paymentMethodId: string;
  paymentMethod: { id: string; name: string; shortCode: string; color: string } | null;
  partnerId: string | null;
  partner: { id: string; name: string } | null;
  periodStart: Date;
  periodEnd: Date;
  openingBalance: { toNumber: () => number };
  totalSales: { toNumber: () => number };
  totalRefunds: { toNumber: () => number };
  netAmount: { toNumber: () => number };
  status: SettlementStatus;
  settledAt: Date | null;
  settledBy?: { name: string } | null;
  notes: string | null;
  createdAt: Date;
}) {
  return {
    id: settlement.id,
    payment_method_id: settlement.paymentMethodId,
    payment_method: settlement.paymentMethod ? {
      id: settlement.paymentMethod.id,
      name: settlement.paymentMethod.name,
      short_code: settlement.paymentMethod.shortCode,
      color: settlement.paymentMethod.color,
    } : null,
    partner_id: settlement.partnerId,
    partner: settlement.partner,
    period_start: settlement.periodStart.toISOString().slice(0, 10),
    period_end: settlement.periodEnd.toISOString().slice(0, 10),
    opening_balance: settlement.openingBalance.toNumber(),
    total_sales: settlement.totalSales.toNumber(),
    total_refunds: settlement.totalRefunds.toNumber(),
    net_amount: settlement.netAmount.toNumber(),
    status: settlement.status.toLowerCase(),
    settled_at: settlement.settledAt,
    settled_by: settlement.settledBy?.name ?? null,
    notes: settlement.notes,
    created_at: settlement.createdAt,
  };
}

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
