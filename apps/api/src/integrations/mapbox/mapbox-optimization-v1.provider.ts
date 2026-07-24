import type {
  RouteOptimizationInput,
  RouteOptimizationProvider,
  RouteOptimizationResult,
  RouteOptimizationSubmitResult,
} from "../../modules/delivery-routing/providers/route-optimization.provider.js";
import { MapboxClient } from "./mapbox.client.js";

interface MapboxOptimizationV1Response {
  code?: string;
  message?: string;
  waypoints?: Array<{
    waypoint_index?: number;
    trips_index?: number;
    location?: [number, number];
    name?: string;
  }>;
  trips?: Array<{
    distance?: number;
    duration?: number;
    geometry?: unknown;
    legs?: Array<{
      distance?: number;
      duration?: number;
    }>;
  }>;
}

const v1Results = new Map<string, RouteOptimizationResult>();

export class MapboxOptimizationV1Provider implements RouteOptimizationProvider {
  constructor(private readonly client = new MapboxClient()) {}

  async submit(input: RouteOptimizationInput): Promise<RouteOptimizationSubmitResult> {
    assertV1Eligible(input);
    const request = mapOptimizationRequest(input);
    const response = await this.client.get<MapboxOptimizationV1Response>(request.path, request.params);
    const result = mapOptimizationResult(input, response);
    const providerJobId = `mapbox-optimization-v1:${input.routePlanId}:${Date.now().toString()}`;
    v1Results.set(providerJobId, result);

    return {
      provider: "mapbox-optimization-v1",
      providerJobId,
      rawRequest: request,
    };
  }

  getResult(providerJobId: string): Promise<RouteOptimizationResult> {
    const result = v1Results.get(providerJobId);
    if (!result) {
      return Promise.resolve({
        status: "failed",
        routes: [],
        droppedServiceIds: [],
        error: "Mapbox Optimization v1 result was not found. Re-run optimization.",
      });
    }

    return Promise.resolve(result);
  }
}

export function canUseMapboxOptimizationV1(input: RouteOptimizationInput): boolean {
  return input.vehicles.length === 1 &&
    input.services.length > 0 &&
    input.services.length <= 11 &&
    input.services.every((service) => service.lockedSequence === undefined);
}

function assertV1Eligible(input: RouteOptimizationInput): void {
  if (!canUseMapboxOptimizationV1(input)) {
    throw new Error("Mapbox Optimization v1 supports one unlocked route with depot plus up to 11 stops.");
  }
}

function mapOptimizationRequest(input: RouteOptimizationInput) {
  const vehicle = input.vehicles[0];
  if (!vehicle) {
    throw new Error("Mapbox Optimization v1 requires one vehicle.");
  }

  const locationById = new Map(input.locations.map((location) => [location.id, location]));
  const orderedLocations = [
    locationById.get(vehicle.startLocationId),
    ...input.services.map((service) => locationById.get(service.locationId)),
  ];

  if (orderedLocations.some((location) => !location)) {
    throw new Error("Mapbox Optimization v1 request has missing stop coordinates.");
  }

  const coordinates = orderedLocations
    .map((location) => `${String(location?.coordinate.longitude)},${String(location?.coordinate.latitude)}`)
    .join(";");

  return {
    path: `/optimized-trips/v1/${vehicle.routingProfile}/${coordinates}`,
    params: {
      source: "first",
      roundtrip: true,
      overview: "full",
      geometries: "geojson",
      steps: false,
    },
  };
}

function mapOptimizationResult(input: RouteOptimizationInput, response: MapboxOptimizationV1Response): RouteOptimizationResult {
  if (response.code !== "Ok") {
    return {
      status: "failed",
      routes: [],
      droppedServiceIds: [],
      rawResult: response,
      error: response.message ?? `Mapbox Optimization v1 returned ${response.code ?? "an unknown status"}.`,
    };
  }

  const vehicle = input.vehicles[0];
  if (!vehicle) {
    return {
      status: "failed",
      routes: [],
      droppedServiceIds: [],
      rawResult: response,
      error: "Mapbox Optimization v1 returned no route vehicle.",
    };
  }

  const trip = response.trips?.[0];
  const waypoints = response.waypoints ?? [];
  const servicesByCoordinateIndex = new Map(input.services.map((service, index) => [index + 1, service]));
  const serviceWaypoints = waypoints
    .map((waypoint, coordinateIndex) => ({ waypoint, coordinateIndex }))
    .filter(({ waypoint, coordinateIndex }) => coordinateIndex > 0 && waypoint.waypoint_index !== undefined && waypoint.waypoint_index > 0)
    .sort((left, right) => (left.waypoint.waypoint_index ?? 0) - (right.waypoint.waypoint_index ?? 0));
  const stops = serviceWaypoints.flatMap(({ waypoint, coordinateIndex }) => {
    const service = servicesByCoordinateIndex.get(coordinateIndex);
    if (!service) {
      return [];
    }

    const legIndex = Math.max((waypoint.waypoint_index ?? 1) - 1, 0);
    const leg = trip?.legs?.[legIndex];
    return [{
      serviceId: service.id,
      deliveryId: service.deliveryId,
      locationId: service.locationId,
      sequence: waypoint.waypoint_index ?? 0,
      durationSeconds: leg?.duration ? Math.round(leg.duration) : service.durationSeconds,
      odometerMeters: undefined,
    }];
  }).sort((left, right) => left.sequence - right.sequence)
    .map((stop, index) => ({ ...stop, sequence: index + 1 }));

  if (stops.length === 0) {
    return {
      status: "failed",
      routes: [],
      droppedServiceIds: [],
      rawResult: response,
      error: "Mapbox Optimization v1 returned no optimized stops.",
    };
  }

  return {
    status: "complete",
    routes: [{
      vehicleId: vehicle.id,
      driverId: vehicle.driverId,
      stops,
      distanceMeters: trip?.distance ? Math.round(trip.distance) : undefined,
      durationSeconds: trip?.duration ? Math.round(trip.duration) : undefined,
    }],
    droppedServiceIds: [],
    rawResult: response,
  };
}
