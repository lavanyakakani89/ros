import { InvoiceStatus, type Prisma, type PrismaClient } from "@prisma/client";

import type { CreateCustomerInput, CustomerListQuery, UpdateCustomerInput } from "./customers.schema.js";

export class CustomersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(tenantId: string, query: CustomerListQuery) {
    const where: Prisma.CustomerWhereInput = {
      tenantId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { phone: { contains: query.search, mode: "insensitive" } },
              { email: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [total, customers] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        include: {
          invoices: {
            where: {
              status: {
                not: InvoiceStatus.CANCELLED,
              },
            },
            select: {
              grandTotal: true,
              amountDue: true,
              invoiceDate: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      data: customers.map((customer) => ({
        ...customer,
        outstandingDue: customer.invoices.reduce((totalDue, invoice) => totalDue + invoice.amountDue.toNumber(), 0),
        totalSpent: customer.invoices.reduce((totalSpent, invoice) => totalSpent + invoice.grandTotal.toNumber(), 0),
        lastVisitAt: customer.invoices.at(0)?.invoiceDate ?? null,
      })),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  create(tenantId: string, input: CreateCustomerInput) {
    return this.prisma.customer.create({
      data: {
        tenantId,
        ...(input.customerCode ? { customerCode: input.customerCode } : {}),
        name: input.name,
        phone: input.phone,
        ...(input.email ? { email: input.email } : {}),
        ...(input.address ? { address: input.address } : {}),
        ...(input.city ? { city: input.city } : {}),
        ...(input.state ? { state: input.state } : {}),
        ...(input.postalCode ? { postalCode: input.postalCode } : {}),
        ...(input.remarks ? { remarks: input.remarks } : {}),
        ...(input.accountNo ? { accountNo: input.accountNo } : {}),
        ...(input.accountName ? { accountName: input.accountName } : {}),
        ...(input.bank ? { bank: input.bank } : {}),
        ...(input.branch ? { branch: input.branch } : {}),
        ...(input.ifscCode ? { ifscCode: input.ifscCode } : {}),
        ...(input.gstin ? { gstin: input.gstin } : {}),
        ...(input.pan ? { pan: input.pan } : {}),
        ...(input.cin ? { cin: input.cin } : {}),
        ...(input.birthday ? { birthday: input.birthday } : {}),
        ...(input.anniversary ? { anniversary: input.anniversary } : {}),
        ...(input.openingBalanceType ? { openingBalanceType: input.openingBalanceType } : {}),
        openingBalance: input.openingBalance,
        tcsEnabled: input.tcsEnabled,
        ...(input.creditLimit !== undefined ? { creditLimit: input.creditLimit } : {}),
        creditLimitEnabled: input.creditLimitEnabled,
        ...(input.creditDays !== undefined ? { creditDays: input.creditDays } : {}),
        itemDiscountPercent: input.itemDiscountPercent,
        itemDiscountEnabled: input.itemDiscountEnabled,
      },
    });
  }

  find(tenantId: string, id: string) {
    return this.prisma.customer.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        invoices: {
          include: {
            items: true,
            payments: true,
          },
          orderBy: {
            invoiceDate: "desc",
          },
        },
        deliveries: true,
      },
    });
  }

  update(tenantId: string, id: string, input: UpdateCustomerInput) {
    return this.prisma.customer.updateMany({
      where: {
        id,
        tenantId,
      },
      data: {
        ...(input.customerCode !== undefined ? { customerCode: input.customerCode } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
        ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
        ...(input.accountNo !== undefined ? { accountNo: input.accountNo } : {}),
        ...(input.accountName !== undefined ? { accountName: input.accountName } : {}),
        ...(input.bank !== undefined ? { bank: input.bank } : {}),
        ...(input.branch !== undefined ? { branch: input.branch } : {}),
        ...(input.ifscCode !== undefined ? { ifscCode: input.ifscCode } : {}),
        ...(input.gstin !== undefined ? { gstin: input.gstin } : {}),
        ...(input.pan !== undefined ? { pan: input.pan } : {}),
        ...(input.cin !== undefined ? { cin: input.cin } : {}),
        ...(input.birthday !== undefined ? { birthday: input.birthday } : {}),
        ...(input.anniversary !== undefined ? { anniversary: input.anniversary } : {}),
        ...(input.openingBalanceType !== undefined ? { openingBalanceType: input.openingBalanceType } : {}),
        ...(input.openingBalance !== undefined ? { openingBalance: input.openingBalance } : {}),
        ...(input.tcsEnabled !== undefined ? { tcsEnabled: input.tcsEnabled } : {}),
        ...(input.creditLimit !== undefined ? { creditLimit: input.creditLimit } : {}),
        ...(input.creditLimitEnabled !== undefined ? { creditLimitEnabled: input.creditLimitEnabled } : {}),
        ...(input.creditDays !== undefined ? { creditDays: input.creditDays } : {}),
        ...(input.itemDiscountPercent !== undefined ? { itemDiscountPercent: input.itemDiscountPercent } : {}),
        ...(input.itemDiscountEnabled !== undefined ? { itemDiscountEnabled: input.itemDiscountEnabled } : {}),
      },
    });
  }
}
