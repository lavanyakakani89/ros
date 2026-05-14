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
  const safeInvoice = { ...typedInvoice };
  delete safeInvoice.subtotal;
  delete safeInvoice.totalDiscount;
  delete safeInvoice.totalCgst;
  delete safeInvoice.totalSgst;
  delete safeInvoice.totalIgst;
  delete safeInvoice.grandTotal;
  delete safeInvoice.amountPaid;
  delete safeInvoice.amountDue;
  delete safeInvoice.paymentMode;
  delete safeInvoice.items;
  delete safeInvoice.lineItems;

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

  const stops = typedRoute.stops as unknown[];
  return {
    ...typedRoute,
    stops: stops.map((stop): unknown => {
      if (!stop || typeof stop !== "object") {
        return stop;
      }

      const typedStop = stop as Record<string, unknown>;
      return typedStop.delivery ? { ...typedStop, delivery: stripDeliveryFinancials(typedStop.delivery) } : typedStop;
    }),
  } as T;
}
