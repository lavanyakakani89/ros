import assert from "node:assert/strict";

import { UserRole } from "@prisma/client";

import { stripCustomerFinancials } from "../modules/customers/customers.sanitizers.js";
import { stripDeliveryFinancials } from "../modules/delivery/delivery.sanitizers.js";
import { canRoleAccess, requiredPermission } from "./rbac.js";

type AccessCase = {
  role: UserRole;
  method: string;
  url: string;
  allowed: boolean;
};

const routeCases: AccessCase[] = [
  { role: UserRole.STAFF, method: "POST", url: "/api/inventory/products", allowed: false },
  { role: UserRole.STAFF, method: "DELETE", url: "/api/billing/invoices/inv_1/cancel", allowed: false },
  { role: UserRole.STAFF, method: "POST", url: "/api/billing/invoices/inv_1/cancel", allowed: false },
  { role: UserRole.STAFF, method: "GET", url: "/api/reports/sales", allowed: false },
  { role: UserRole.STAFF, method: "GET", url: "/api/settings/tenant", allowed: false },
  { role: UserRole.STAFF, method: "POST", url: "/api/billing/invoices", allowed: true },
  { role: UserRole.STAFF, method: "POST", url: "/api/billing/invoices/inv_1/confirm", allowed: true },
  { role: UserRole.STAFF, method: "GET", url: "/api/customers", allowed: true },
  { role: UserRole.STAFF, method: "POST", url: "/api/expenses", allowed: true },
  { role: UserRole.STAFF, method: "GET", url: "/api/expenses", allowed: true },
  { role: UserRole.STAFF, method: "DELETE", url: "/api/expenses/exp_1", allowed: false },
  { role: UserRole.MANAGER, method: "GET", url: "/api/reports/pl", allowed: false },
  { role: UserRole.MANAGER, method: "GET", url: "/api/reports/pnl", allowed: false },
  { role: UserRole.MANAGER, method: "PUT", url: "/api/settings/tenant", allowed: false },
  { role: UserRole.MANAGER, method: "POST", url: "/api/settings/users", allowed: true },
  { role: UserRole.DELIVERY, method: "GET", url: "/api/billing/invoices", allowed: false },
  { role: UserRole.DELIVERY, method: "GET", url: "/api/inventory/products", allowed: false },
  { role: UserRole.DELIVERY, method: "GET", url: "/api/customers", allowed: false },
  { role: UserRole.DELIVERY, method: "GET", url: "/api/reports/sales", allowed: false },
  { role: UserRole.DELIVERY, method: "GET", url: "/api/delivery/me", allowed: true },
  { role: UserRole.DELIVERY, method: "GET", url: "/api/delivery/del_1", allowed: true },
  { role: UserRole.DELIVERY, method: "PUT", url: "/api/delivery/del_1/status", allowed: true },
  { role: UserRole.DELIVERY, method: "POST", url: "/api/delivery/routes/optimize", allowed: false },
  { role: UserRole.OWNER, method: "GET", url: "/api/reports/pnl", allowed: true },
  { role: UserRole.OWNER, method: "PUT", url: "/api/settings/tenant", allowed: true },
];

for (const testCase of routeCases) {
  assert.equal(
    canRoleAccess(testCase.role, testCase.method, testCase.url),
    testCase.allowed,
    `${testCase.role} ${testCase.method} ${testCase.url}`,
  );
}

assert.equal(requiredPermission("GET", "/api/reports/pl"), "reports:pnl");
assert.equal(requiredPermission("DELETE", "/api/billing/invoices/inv_1/cancel"), "billing:cancel");
assert.equal(requiredPermission("GET", "/api/delivery/del_1"), "delivery:mobile");

const staffCustomer = stripCustomerFinancials({
  id: "customer_1",
  name: "Test customer",
  phone: "9999999999",
  creditLimit: 5000,
  outstandingDue: 230,
  totalSpent: 1200,
  invoices: [{ id: "inv_1" }],
});

assert.equal("creditLimit" in staffCustomer, false);
assert.equal("outstandingDue" in staffCustomer, false);
assert.equal("totalSpent" in staffCustomer, false);
assert.equal("invoices" in staffCustomer, false);

const deliveryView = stripDeliveryFinancials({
  id: "delivery_1",
  deliveryAddress: "Hyderabad",
  invoice: {
    invoiceNumber: "INV-1",
    subtotal: 100,
    grandTotal: 100,
    amountDue: 100,
    paymentMode: "CASH",
    items: [{ productName: "Oil" }],
  },
  customer: {
    name: "Customer",
    phone: "9999999999",
    address: "Hyderabad",
  },
});

assert.equal("grandTotal" in deliveryView.invoice, false);
assert.equal("amountDue" in deliveryView.invoice, false);
assert.equal("paymentMode" in deliveryView.invoice, false);
assert.equal("items" in deliveryView.invoice, false);
assert.equal((deliveryView as Record<string, unknown>).codAmount, 100);

console.log("RBAC permission and field-filter tests passed.");
