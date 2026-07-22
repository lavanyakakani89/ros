import type {
  RouteGeometryInput,
  RouteGeometryProvider,
  RouteGeometryResult,
  RouteOptimizationInput,
  RouteOptimizationProvider,
  RouteOptimizationResult,
  RouteOptimizationSubmitResult,
  RoutingCoordinate,
} from "./route-optimization.provider.js";

const manualResults = new Map<string, RouteOptimizationResult>();

export class ManualOrderingProvider implements RouteOptimizationProvider {
  submit(input: RouteOptimizationInput): Promise<RouteOptimizationSubmitResult> {
    const providerJobId = `manual:${input.routePlanId}:${Date.now().toString()}`;
    manualResults.set(providerJobId, optimizeManually(input));

    return Promise.resolve({
      provider: "manual",
      providerJobId,
      rawRequest: input,
    });
  }

  getResult(providerJobId: string): Promise<RouteOptimizationResult> {
    const result = manualResults.get(providerJobId);
    if (!result) {
      return Promise.resolve({
        status: "failed",
        routes: [],
        droppedServiceIds: [],
        error: "Manual route result was not found. Re-run optimization.",
      });
    }

    return Promise.resolve(result);
  }
}

export class StraightLineGeometryProvider implements RouteGeometryProvider {
  getGeometry(input: RouteGeometryInput): Promise<RouteGeometryResult | null> {
    if (input.coordinates.length < 2) {
      return Promise.resolve(null);
    }

    let distanceMeters = 0;
    for (let index = 1; index < input.coordinates.length; index += 1) {
      const previous = input.coordinates[index - 1];
      const current = input.coordinates[index];
      if (previous && current) {
        distanceMeters += haversineMeters(previous, current);
      }
    }

    return Promise.resolve({
      provider: "manual",
      distanceMeters: Math.round(distanceMeters),
      durationSeconds: Math.round(distanceMeters / 8.33),
      geometry: {
        type: "LineString",
        coordinates: input.coordinates.map((coordinate) => [coordinate.longitude, coordinate.latitude]),
      },
    });
  }
}

function optimizeManually(input: RouteOptimizationInput): RouteOptimizationResult {
  const locations = new Map(input.locations.map((location) => [location.id, location]));
  const remaining = [...input.services].sort((left, right) => (left.lockedSequence ?? Number.MAX_SAFE_INTEGER) - (right.lockedSequence ?? Number.MAX_SAFE_INTEGER));
  const routes = input.vehicles.map((vehicle) => {
    const assigned = remaining.splice(0, Math.ceil(remaining.length / Math.max(1, input.vehicles.length - input.vehicles.indexOf(vehicle))));
    const ordered = nearestNeighborOrder(vehicle.startLocationId, assigned, locations);
    let previous = locations.get(vehicle.startLocationId)?.coordinate;
    let distanceMeters = 0;
    const stops = ordered.map((service, index) => {
      const current = locations.get(service.locationId)?.coordinate;
      if (previous && current) {
        distanceMeters += haversineMeters(previous, current);
      }
      previous = current;

      return {
        serviceId: service.id,
        deliveryId: service.deliveryId,
        locationId: service.locationId,
        sequence: index + 1,
        durationSeconds: service.durationSeconds,
        odometerMeters: Math.round(distanceMeters),
      };
    });

    const durationSeconds = Math.round(distanceMeters / 8.33) + ordered.reduce((total, service) => total + service.durationSeconds, 0);

    return {
      vehicleId: vehicle.id,
      driverId: vehicle.driverId,
      distanceMeters: Math.round(distanceMeters),
      durationSeconds,
      stops,
    };
  });

  return {
    status: "complete",
    routes,
    droppedServiceIds: [],
    rawResult: {
      provider: "manual",
      note: "Nearest-neighbor route ordering generated inside BizBil.",
    },
  };
}

function nearestNeighborOrder(
  startLocationId: string,
  services: RouteOptimizationInput["services"],
  locations: Map<string, RouteOptimizationInput["locations"][number]>,
): RouteOptimizationInput["services"] {
  const ordered: RouteOptimizationInput["services"] = [];
  const remaining = [...services];
  let current = locations.get(startLocationId)?.coordinate;

  while (remaining.length > 0) {
    if (!current) {
      ordered.push(...remaining.splice(0));
      break;
    }

    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [index, service] of remaining.entries()) {
      const candidate = locations.get(service.locationId)?.coordinate;
      if (!candidate) {
        continue;
      }

      const distance = haversineMeters(current, candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    const [next] = remaining.splice(bestIndex, 1);
    if (!next) {
      break;
    }
    ordered.push(next);
    current = locations.get(next.locationId)?.coordinate;
  }

  return ordered;
}

function haversineMeters(left: RoutingCoordinate, right: RoutingCoordinate): number {
  const earthRadiusMeters = 6_371_000;
  const phi1 = toRadians(left.latitude);
  const phi2 = toRadians(right.latitude);
  const deltaPhi = toRadians(right.latitude - left.latitude);
  const deltaLambda = toRadians(right.longitude - left.longitude);
  const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}
