import type {
  RouteOptimizationInput,
  RouteOptimizationProvider,
  RouteOptimizationResult,
  RouteOptimizationSubmitResult,
} from "../../modules/delivery-routing/providers/route-optimization.provider.js";
import { MapboxClient } from "./mapbox.client.js";

interface MapboxOptimizationSubmitResponse {
  id: string;
  status: string;
  status_date?: string;
}

interface MapboxOptimizationSolution {
  code?: string;
  message?: string;
  status?: string;
  dropped?: {
    services?: string[];
    shipments?: string[];
  };
  routes?: Array<{
    vehicle: string;
    stops?: Array<{
      type: string;
      location: string;
      eta?: string;
      wait?: number;
      duration?: number;
      odometer?: number;
      services?: string[];
      dropoffs?: string[];
      pickups?: string[];
    }>;
  }>;
}

export class MapboxOptimizationV2Provider implements RouteOptimizationProvider {
  constructor(private readonly client = new MapboxClient()) {}

  async submit(input: RouteOptimizationInput): Promise<RouteOptimizationSubmitResult> {
    if (input.services.some((service) => service.lockedSequence !== undefined)) {
      throw new Error("Mapbox Optimization v2 locked-stop ordering is not enabled yet. Unlock stops or use the manual route planner.");
    }

    const request = mapOptimizationRequest(input);
    const response = await this.client.post<MapboxOptimizationSubmitResponse>("/optimized-trips/v2", request);
    if (!response.id) {
      throw new Error("Mapbox Optimization v2 did not return a job id.");
    }

    return {
      provider: "mapbox-optimization-v2",
      providerJobId: response.id,
      rawRequest: request,
    };
  }

  async getResult(providerJobId: string): Promise<RouteOptimizationResult> {
    const response = await this.client.get<MapboxOptimizationSolution | null>(`/optimized-trips/v2/${providerJobId}`);
    if (!response) {
      return {
        status: "processing",
        routes: [],
        droppedServiceIds: [],
        rawResult: response,
      };
    }

    if (isProcessingStatus(response.status) && !response.routes) {
      return {
        status: "processing",
        routes: [],
        droppedServiceIds: [],
        rawResult: response,
      };
    }

    if (isFailedStatus(response.status, response.code)) {
      return {
        status: "failed",
        routes: [],
        droppedServiceIds: [],
        rawResult: response,
        error: response.message ?? `Mapbox Optimization v2 returned ${response.status ?? response.code ?? "a failed status"}.`,
      };
    }

    const solution = response;
    const routes = (solution.routes ?? []).map((route) => {
      let sequence = 0;
      const stops = (route.stops ?? [])
        .flatMap((stop) => {
          const serviceIds = stop.services ?? stop.dropoffs ?? stop.pickups ?? [];
          return serviceIds.map((serviceId) => {
            sequence += 1;
            return {
              serviceId,
              locationId: stop.location,
              eta: stop.eta,
              sequence,
              durationSeconds: stop.duration,
              waitSeconds: stop.wait,
              odometerMeters: stop.odometer ? Math.round(stop.odometer) : undefined,
            };
          });
        });

      return {
        vehicleId: route.vehicle,
        stops,
        distanceMeters: stops.at(-1)?.odometerMeters,
      };
    });
    if (routes.length === 0 && !solution.dropped?.services?.length && !solution.dropped?.shipments?.length) {
      return {
        status: "failed",
        routes: [],
        droppedServiceIds: [],
        rawResult: solution,
        error: "Mapbox Optimization v2 returned no routes.",
      };
    }

    return {
      status: "complete",
      routes,
      droppedServiceIds: [...(solution.dropped?.services ?? []), ...(solution.dropped?.shipments ?? [])],
      rawResult: solution,
    };
  }
}

function isProcessingStatus(status: string | undefined): boolean {
  return status === "pending" || status === "processing" || status === "accepted";
}

function isFailedStatus(status: string | undefined, code: string | undefined): boolean {
  return status === "failed" || status === "error" || code === "Error" || code === "Unauthorized" || code === "Unacceptable";
}

function mapOptimizationRequest(input: RouteOptimizationInput) {
  return {
    version: 1,
    locations: input.locations.map((location) => ({
      name: location.id,
      coordinates: [location.coordinate.longitude, location.coordinate.latitude],
    })),
    vehicles: input.vehicles.map((vehicle) => ({
      name: vehicle.id,
      routing_profile: vehicle.routingProfile,
      start_location: vehicle.startLocationId,
      end_location: vehicle.endLocationId ?? vehicle.startLocationId,
    })),
    services: input.services.map((service) => ({
      name: service.id,
      location: service.locationId,
      duration: service.durationSeconds,
    })),
    options: {
      objectives: [input.objective],
    },
  };
}
