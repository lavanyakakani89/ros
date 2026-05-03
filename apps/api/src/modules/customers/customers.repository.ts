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
        name: input.name,
        phone: input.phone,
        ...(input.email ? { email: input.email } : {}),
        ...(input.address ? { address: input.address } : {}),
        ...(input.creditLimit !== undefined ? { creditLimit: input.creditLimit } : {}),
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
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.creditLimit !== undefined ? { creditLimit: input.creditLimit } : {}),
      },
    });
  }
}
