import type { Prisma, PrismaClient } from "@prisma/client";

import type { CreateSupplierInput, SupplierListQuery, UpdateSupplierInput } from "./suppliers.schema.js";

export class SuppliersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(tenantId: string, query: SupplierListQuery) {
    const where: Prisma.SupplierWhereInput = {
      tenantId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { phone: { contains: query.search, mode: "insensitive" } },
              { gstNumber: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.findMany({
        where,
        include: {
          _count: {
            select: {
              products: true,
              purchaseOrders: true,
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
      data,
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  create(tenantId: string, input: CreateSupplierInput) {
    return this.prisma.supplier.create({
      data: {
        tenantId,
        name: input.name,
        phone: input.phone,
        ...(input.email ? { email: input.email } : {}),
        ...(input.gstNumber ? { gstNumber: input.gstNumber } : {}),
        ...(input.address ? { address: input.address } : {}),
      },
    });
  }

  find(tenantId: string, id: string) {
    return this.prisma.supplier.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        products: true,
        purchaseOrders: {
          include: {
            items: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });
  }

  update(tenantId: string, id: string, input: UpdateSupplierInput) {
    return this.prisma.supplier.updateMany({
      where: {
        id,
        tenantId,
      },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.gstNumber !== undefined ? { gstNumber: input.gstNumber } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
      },
    });
  }
}
