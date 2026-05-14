export function stripCustomerFinancials<T extends Record<string, unknown>>(customer: T) {
  const safeCustomer = { ...customer };
  delete safeCustomer.creditLimit;
  delete safeCustomer.outstandingDue;
  delete safeCustomer.totalSpent;
  delete safeCustomer.invoices;
  return safeCustomer;
}
