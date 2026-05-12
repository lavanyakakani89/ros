export function stripDeliveryFinancials<T>(delivery: T): T {
  if (!delivery || typeof delivery !== "object") {
    return delivery;
  }

  const typedDelivery = delivery as Record<string, unknown>;
  const invoice = typedDelivery.invoice;
  if (!invoice || typeof invoice !== "object") {
    return delivery;
  }

  const typedInvoice = invoice as Record<string, unknown>;
  const codAmount = typedInvoice.amountDue ?? typedInvoice.grandTotal ?? null;
  const {
    subtotal: _subtotal,
    totalDiscount: _totalDiscount,
    totalCgst: _totalCgst,
    totalSgst: _totalSgst,
    totalIgst: _totalIgst,
    grandTotal: _grandTotal,
    amountPaid: _amountPaid,
    amountDue: _amountDue,
    paymentMode: _paymentMode,
    items: _items,
    lineItems: _lineItems,
    ...safeInvoice
  } = typedInvoice;

  return {
    ...typedDelivery,
    codAmount,
    invoice: safeInvoice,
  } as T;
}

export function stripRouteFinancials<T>(route: T): T {
  if (!route || typeof route !== "object") {
    return route;
  }

  const typedRoute = route as Record<string, unknown>;
  if (!Array.isArray(typedRoute.stops)) {
    return route;
  }

  return {
    ...typedRoute,
    stops: typedRoute.stops.map((stop) => {
      if (!stop || typeof stop !== "object") {
        return stop;
      }

      const typedStop = stop as Record<string, unknown>;
      return typedStop.delivery ? { ...typedStop, delivery: stripDeliveryFinancials(typedStop.delivery) } : typedStop;
    }),
  } as T;
}
