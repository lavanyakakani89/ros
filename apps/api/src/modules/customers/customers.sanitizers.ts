export function stripCustomerFinancials<T extends Record<string, unknown>>(customer: T) {
  const {
    creditLimit: _creditLimit,
    outstandingDue: _outstandingDue,
    totalSpent: _totalSpent,
    invoices: _invoices,
    ...safeCustomer
  } = customer;

  return safeCustomer;
}
