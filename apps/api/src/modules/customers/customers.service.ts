import type { Tenant } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { CustomersRepository } from "./customers.repository.js";
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

  listCustomers(tenant: Tenant, query: CustomerListQuery) {
    return this.repository.list(tenant.id, query);
  }

  async createCustomer(tenant: Tenant, input: CreateCustomerInput) {
    try {
      return await this.repository.create(tenant.id, input);
    } catch (error) {
      throw new CustomersError(error instanceof Error ? error.message : "Unable to create customer", 409);
    }
  }

  async getCustomer(tenant: Tenant, id: string) {
    const customer = await this.repository.find(tenant.id, id);
    if (!customer) {
      throw new CustomersError("Customer not found", 404);
    }

    const totalSpent = customer.invoices.reduce((total, invoice) => total + invoice.grandTotal.toNumber(), 0);
    const outstandingDue = customer.invoices.reduce((total, invoice) => total + invoice.amountDue.toNumber(), 0);

    return {
      ...customer,
      totalSpent,
      outstandingDue,
      lastVisitAt: customer.invoices[0]?.invoiceDate ?? null,
    };
  }

  async updateCustomer(tenant: Tenant, id: string, input: UpdateCustomerInput) {
    try {
      const result = await this.repository.update(tenant.id, id, input);
      if (result.count === 0) {
        throw new CustomersError("Customer not found", 404);
      }

      return await this.getCustomer(tenant, id);
    } catch (error) {
      if (error instanceof CustomersError) {
        throw error;
      }

      throw new CustomersError(error instanceof Error ? error.message : "Unable to update customer", 409);
    }
  }
}
