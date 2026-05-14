import { UserRole, type Tenant } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { CustomersRepository } from "./customers.repository.js";
import { stripCustomerFinancials } from "./customers.sanitizers.js";
import type { CreateCustomerInput, CustomerListQuery, UpdateCustomerInput } from "./customers.schema.js";

export class CustomersError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export class CustomersService {
  private readonly repository: CustomersRepository;

  constructor(fastify: FastifyInstance) {
    this.repository = new CustomersRepository(fastify.prisma);
  }

  async listCustomers(tenant: Tenant, query: CustomerListQuery, role?: UserRole) {
    const result = await this.repository.list(tenant.id, query);
    if (role !== UserRole.STAFF) {
      return result;
    }

    return {
      ...result,
      data: result.data.map(stripCustomerFinancials),
    };
  }

  async createCustomer(tenant: Tenant, input: CreateCustomerInput, role?: UserRole) {
    try {
      return await this.repository.create(tenant.id, sanitizeCustomerInputForRole(input, role));
    } catch (error) {
      throw new CustomersError(error instanceof Error ? error.message : "Unable to create customer", 409);
    }
  }

  async getCustomer(tenant: Tenant, id: string, role?: UserRole) {
    const customer = await this.repository.find(tenant.id, id);
    if (!customer) {
      throw new CustomersError("Customer not found", 404);
    }

    const totalSpent = customer.invoices.reduce((total, invoice) => total + invoice.grandTotal.toNumber(), 0);
    const outstandingDue = customer.invoices.reduce((total, invoice) => total + invoice.amountDue.toNumber(), 0);

    const result = {
      ...customer,
      totalSpent,
      outstandingDue,
      lastVisitAt: customer.invoices[0]?.invoiceDate ?? null,
    };

    return role === UserRole.STAFF ? stripCustomerFinancials(result) : result;
  }

  async updateCustomer(tenant: Tenant, id: string, input: UpdateCustomerInput, role?: UserRole) {
    try {
      const result = await this.repository.update(tenant.id, id, sanitizeCustomerInputForRole(input, role));
      if (result.count === 0) {
        throw new CustomersError("Customer not found", 404);
      }

      return await this.getCustomer(tenant, id, role);
    } catch (error) {
      if (error instanceof CustomersError) {
        throw error;
      }

      throw new CustomersError(error instanceof Error ? error.message : "Unable to update customer", 409);
    }
  }
}

function sanitizeCustomerInputForRole<T extends CreateCustomerInput | UpdateCustomerInput>(input: T, role?: UserRole): T {
  if (role !== UserRole.STAFF) {
    return input;
  }

  const basicInput = { ...input };
  delete basicInput.openingBalanceType;
  delete basicInput.openingBalance;
  delete basicInput.tcsEnabled;
  delete basicInput.creditLimit;
  delete basicInput.creditLimitEnabled;
  delete basicInput.creditDays;
  delete basicInput.itemDiscountPercent;
  delete basicInput.itemDiscountEnabled;
  return basicInput;
}
