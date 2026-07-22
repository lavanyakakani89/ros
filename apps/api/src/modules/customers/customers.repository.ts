import { DeliveryRoutePlanStatus, DeliveryRouteStopStatus, DeliveryStatus, InvoiceStatus, type Prisma, type PrismaClient } from "@prisma/client";

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
          locations: {
            where: { isDefault: true },
            take: 1,
          },
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

  create(tenantId: string, userId: string, input: CreateCustomerInput) {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: customerData(input, tenantId),
      });

      if (input.location) {
        await upsertDefaultLocation(tx, tenantId, userId, customer.id, input);
      }

      return customer;
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
        locations: {
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        },
      },
    });
  }

  update(tenantId: string, userId: string, id: string, input: UpdateCustomerInput) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.customer.updateMany({
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

      if (result.count > 0 && input.location) {
        await upsertDefaultLocation(tx, tenantId, userId, id, input);
      }

      return result;
    });
  }
}

function customerData(input: CreateCustomerInput, tenantId: string): Prisma.CustomerCreateInput {
  return {
    tenant: { connect: { id: tenantId } },
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
    ...(input.openingBalanceType ? { openingBalanceType: input.openingBalanceType } : {}),
    openingBalance: input.openingBalance,
    tcsEnabled: input.tcsEnabled,
    ...(input.creditLimit !== undefined ? { creditLimit: input.creditLimit } : {}),
    creditLimitEnabled: input.creditLimitEnabled,
    ...(input.creditDays !== undefined ? { creditDays: input.creditDays } : {}),
    itemDiscountPercent: input.itemDiscountPercent,
    itemDiscountEnabled: input.itemDiscountEnabled,
  };
}

async function upsertDefaultLocation(
  prisma: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  customerId: string,
  input: CreateCustomerInput | UpdateCustomerInput,
) {
  if (!input.location) return;

  const existing = await prisma.customerLocation.findFirst({
    where: { tenantId, customerId, isDefault: true },
    select: { id: true },
  });
  const address = input.address?.trim() || "Customer location";
  const data = {
    addressLine1: address,
    latitude: input.location.latitude,
    longitude: input.location.longitude,
    geocodingProvider: input.location.source === "GOOGLE_MAPS_URL" ? "google_maps_url" : "coordinates",
    geocodingQuery: input.location.query ?? null,
    geocodingAccuracy: "user_confirmed_coordinates",
    geocodingConfidence: 1,
    geocodedAt: new Date(),
    manuallyVerifiedAt: new Date(),
    manuallyVerifiedById: userId,
    isDefault: true,
  };

  if (existing) {
    await prisma.customerLocation.update({
      where: { id: existing.id },
      data,
    });
    await syncActiveDeliveryPinsForCustomer(prisma, tenantId, customerId, existing.id, input.location.latitude, input.location.longitude);
    return;
  }

  const created = await prisma.customerLocation.create({
    data: {
      tenantId,
      customerId,
      label: "Default",
      ...data,
    },
  });
  await syncActiveDeliveryPinsForCustomer(prisma, tenantId, customerId, created.id, input.location.latitude, input.location.longitude);
}

async function syncActiveDeliveryPinsForCustomer(
  prisma: Prisma.TransactionClient,
  tenantId: string,
  customerId: string,
  customerLocationId: string,
  latitude: number,
  longitude: number,
) {
  const activeDeliveryStatus = [DeliveryStatus.PENDING, DeliveryStatus.ASSIGNED, DeliveryStatus.OUT_FOR_DELIVERY];
  await prisma.delivery.updateMany({
    where: {
      tenantId,
      customerId,
      status: { in: activeDeliveryStatus },
    },
    data: {
      customerLocationId,
      deliveryLatitude: latitude,
      deliveryLongitude: longitude,
    },
  });

  await prisma.deliveryRouteStop.updateMany({
    where: {
      tenantId,
      status: {
        in: [
          DeliveryRouteStopStatus.PLANNED,
          DeliveryRouteStopStatus.LOCKED,
          DeliveryRouteStopStatus.EN_ROUTE,
          DeliveryRouteStopStatus.ARRIVED,
          DeliveryRouteStopStatus.RESCHEDULED,
        ],
      },
      delivery: {
        tenantId,
        customerId,
        status: { in: activeDeliveryStatus },
      },
      route: {
        routePlan: {
          status: {
            in: [
              DeliveryRoutePlanStatus.DRAFT,
              DeliveryRoutePlanStatus.GEOCODING,
              DeliveryRoutePlanStatus.LOCATION_REVIEW_REQUIRED,
              DeliveryRoutePlanStatus.QUEUED,
              DeliveryRoutePlanStatus.OPTIMIZING,
              DeliveryRoutePlanStatus.OPTIMIZATION_FAILED,
              DeliveryRoutePlanStatus.READY_FOR_REVIEW,
              DeliveryRoutePlanStatus.APPLIED,
              DeliveryRoutePlanStatus.PUBLISHED,
              DeliveryRoutePlanStatus.IN_PROGRESS,
            ],
          },
        },
      },
    },
    data: {
      latitude,
      longitude,
    },
  });
}
