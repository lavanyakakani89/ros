import type { Delivery, DeliveryRoute } from "@prisma/client";

export interface RouteDeliveryCandidate extends Delivery {
  invoice: {
    grandTotal: { toNumber(): number };
    amountDue: { toNumber(): number };
    paymentMode: string;
  };
  customer: {
    name: string;
    phone: string;
  };
}

export interface RouteVehicle {
  id: string;
  name: string;
}

export interface OptimizeRoutePlanInput {
  candidates: RouteDeliveryCandidate[];
  vehicles: RouteVehicle[];
  depotLatitude?: number | undefined;
  depotLongitude?: number | undefined;
  vehicleCapacityKg?: number | undefined;
  maxDistanceMeters?: number | undefined;
  returnToDepot: boolean;
}

export interface OptimizedRoutePlan {
  provider: string;
  routes: Array<{
    assignedTo: string;
    depotLatitude?: number | undefined;
    depotLongitude?: number | undefined;
    totalDistanceMeters?: number | undefined;
    totalDurationSeconds?: number | undefined;
    routeGeometry?: unknown;
    stops: Array<{
      deliveryId: string;
      sequence: number;
      eta?: Date | undefined;
      distanceMeters?: number | undefined;
      durationSeconds?: number | undefined;
    }>;
  }>;
  warnings: string[];
}

export async function optimizeDeliveryRoutePlan(input: OptimizeRoutePlanInput): Promise<OptimizedRoutePlan> {
  const candidatesWithCoordinates = input.candidates.filter(hasCoordinates);
  const warnings: string[] = [];

  if (candidatesWithCoordinates.length !== input.candidates.length) {
    warnings.push(`${String(input.candidates.length - candidatesWithCoordinates.length)} deliveries are missing lat/lng and were not optimized.`);
  }

  if (candidatesWithCoordinates.length === 0 || input.vehicles.length === 0) {
    return {
      provider: "none",
      routes: [],
      warnings,
    };
  }

  const vroomBaseUrl = process.env.VROOM_BASE_URL?.replace(/\/+$/, "");
  if (vroomBaseUrl) {
    const vroomPlan = await tryVroom(vroomBaseUrl, input, candidatesWithCoordinates).catch(() => null);
    if (vroomPlan) {
      return {
        ...vroomPlan,
        warnings,
      };
    }

    warnings.push("Vroom was unavailable; used local nearest-stop fallback.");
  }

  return {
    provider: "local-nearest-neighbor",
    routes: buildFallbackRoutes(input, candidatesWithCoordinates),
    warnings,
  };
}

export function summarizeRoute(route: DeliveryRoute & { stops?: unknown[] }) {
  return {
    id: route.id,
    assignedTo: route.assignedTo,
    status: route.status,
    totalDistanceMeters: route.totalDistanceMeters,
    totalDurationSeconds: route.totalDurationSeconds,
    routeGeometry: route.routeGeometry,
    optimizedAt: route.optimizedAt,
    stops: route.stops ?? [],
  };
}

async function tryVroom(
  vroomBaseUrl: string,
  input: OptimizeRoutePlanInput,
  candidates: RouteDeliveryCandidate[],
): Promise<OptimizedRoutePlan | null> {
  const jobs = candidates.map((delivery, index) => ({
    id: index + 1,
    location: [Number(delivery.longitude), Number(delivery.latitude)],
    priority: Math.max(0, Math.min(100, delivery.priority)),
    amount: input.vehicleCapacityKg ? [Math.ceil(Number(delivery.weightKg ?? 1))] : undefined,
    time_windows: delivery.timeWindowStart && delivery.timeWindowEnd
      ? [[Math.floor(delivery.timeWindowStart.getTime() / 1000), Math.floor(delivery.timeWindowEnd.getTime() / 1000)]]
      : undefined,
  }));

  const vehicles = input.vehicles.map((vehicle, index) => ({
    id: index + 1,
    description: vehicle.id,
    start: input.depotLatitude !== undefined && input.depotLongitude !== undefined ? [input.depotLongitude, input.depotLatitude] : undefined,
    end: input.returnToDepot && input.depotLatitude !== undefined && input.depotLongitude !== undefined ? [input.depotLongitude, input.depotLatitude] : undefined,
    capacity: input.vehicleCapacityKg ? [Math.floor(input.vehicleCapacityKg)] : undefined,
    max_distance: input.maxDistanceMeters,
  }));

  const response = await fetch(vroomBaseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jobs, vehicles }),
  });

  if (!response.ok) {
    return null;
  }

  const body = await response.json() as {
    routes?: Array<{
      vehicle: number;
      distance?: number;
      duration?: number;
      steps?: Array<{ type: string; job?: number; arrival?: number; distance?: number; duration?: number }>;
    }>;
  };

  if (!body.routes?.length) {
    return null;
  }

  return {
    provider: "vroom",
    warnings: [],
    routes: body.routes.map((route) => {
      const vehicle = input.vehicles[route.vehicle - 1] ?? input.vehicles[0];
      if (!vehicle) {
        return null;
      }

      const stops = (route.steps ?? [])
        .filter((step) => step.type === "job" && step.job !== undefined)
        .map((step, index) => {
          const delivery = candidates[(step.job ?? 1) - 1];
          if (!delivery) {
            return null;
          }

          return {
            deliveryId: delivery.id,
            sequence: index + 1,
            ...(step.arrival ? { eta: new Date(step.arrival * 1000) } : {}),
            ...(step.distance !== undefined ? { distanceMeters: step.distance } : {}),
            ...(step.duration !== undefined ? { durationSeconds: step.duration } : {}),
          };
        })
        .filter((stop): stop is NonNullable<typeof stop> => stop !== null);

      if (stops.length === 0) {
        return null;
      }

      return {
        assignedTo: vehicle.id,
        ...(input.depotLatitude !== undefined ? { depotLatitude: input.depotLatitude } : {}),
        ...(input.depotLongitude !== undefined ? { depotLongitude: input.depotLongitude } : {}),
        ...(route.distance !== undefined ? { totalDistanceMeters: route.distance } : {}),
        ...(route.duration !== undefined ? { totalDurationSeconds: route.duration } : {}),
        stops,
      };
    }).filter((route): route is NonNullable<typeof route> => route !== null),
  };
}

function buildFallbackRoutes(input: OptimizeRoutePlanInput, candidates: RouteDeliveryCandidate[]): OptimizedRoutePlan["routes"] {
  const routes = new Map<string, RouteDeliveryCandidate[]>();

  for (const delivery of candidates) {
    const assignedTo = delivery.assignedTo && input.vehicles.some((vehicle) => vehicle.id === delivery.assignedTo)
      ? delivery.assignedTo
      : input.vehicles[0]?.id;

    if (!assignedTo) {
      continue;
    }

    routes.set(assignedTo, [...(routes.get(assignedTo) ?? []), delivery]);
  }

  return [...routes.entries()].map(([assignedTo, deliveries]) => {
    const ordered = nearestNeighbor(deliveries, input.depotLatitude, input.depotLongitude);
    return {
      assignedTo,
      ...(input.depotLatitude !== undefined ? { depotLatitude: input.depotLatitude } : {}),
      ...(input.depotLongitude !== undefined ? { depotLongitude: input.depotLongitude } : {}),
      totalDistanceMeters: Math.round(estimateRouteDistanceMeters(ordered, input.depotLatitude, input.depotLongitude)),
      stops: ordered.map((delivery, index) => ({
        deliveryId: delivery.id,
        sequence: index + 1,
      })),
    };
  });
}

function nearestNeighbor(deliveries: RouteDeliveryCandidate[], depotLatitude?: number, depotLongitude?: number) {
  const remaining = [...deliveries].sort((left, right) => right.priority - left.priority);
  const ordered: RouteDeliveryCandidate[] = [];
  let currentLatitude = depotLatitude ?? Number(remaining[0]?.latitude ?? 0);
  let currentLongitude = depotLongitude ?? Number(remaining[0]?.longitude ?? 0);

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const [index, delivery] of remaining.entries()) {
      const distance = haversineMeters(currentLatitude, currentLongitude, Number(delivery.latitude), Number(delivery.longitude));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    const next = remaining.splice(bestIndex, 1)[0];
    if (next === undefined) {
      break;
    }

    ordered.push(next);
    currentLatitude = Number(next.latitude);
    currentLongitude = Number(next.longitude);
  }

  return ordered;
}

function estimateRouteDistanceMeters(deliveries: RouteDeliveryCandidate[], depotLatitude?: number, depotLongitude?: number): number {
  let total = 0;
  let currentLatitude = depotLatitude ?? Number(deliveries[0]?.latitude ?? 0);
  let currentLongitude = depotLongitude ?? Number(deliveries[0]?.longitude ?? 0);

  for (const delivery of deliveries) {
    total += haversineMeters(currentLatitude, currentLongitude, Number(delivery.latitude), Number(delivery.longitude));
    currentLatitude = Number(delivery.latitude);
    currentLongitude = Number(delivery.longitude);
  }

  return total;
}

function haversineMeters(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const earthRadiusMeters = 6_371_000;
  const dLat = degreesToRadians(toLat - fromLat);
  const dLng = degreesToRadians(toLng - fromLng);
  const lat1 = degreesToRadians(fromLat);
  const lat2 = degreesToRadians(toLat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function hasCoordinates(delivery: Delivery): delivery is RouteDeliveryCandidate {
  return delivery.latitude !== null && delivery.longitude !== null;
}
