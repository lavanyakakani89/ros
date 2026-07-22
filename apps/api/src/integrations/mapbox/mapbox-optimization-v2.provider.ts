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
}

interface MapboxOptimizationSolution {
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
    const request = mapOptimizationRequest(input);
    const response = await this.client.post<MapboxOptimizationSubmitResponse>("/optimized-trips/v2", request);

    return {
      provider: "mapbox-optimization-v2",
      providerJobId: response.id,
      rawRequest: request,
    };
  }

  async getResult(providerJobId: string): Promise<RouteOptimizationResult> {
    const response = await this.client.get<MapboxOptimizationSolution | { status?: string }>(`/optimized-trips/v2/${providerJobId}`);
    if ("status" in response && response.status && response.status !== "complete" && !("routes" in response)) {
      return {
        status: "processing",
        routes: [],
        droppedServiceIds: [],
        rawResult: response,
      };
    }

    const solution = response as MapboxOptimizationSolution;
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

    return {
      status: "complete",
      routes,
      droppedServiceIds: solution.dropped?.services ?? [],
      rawResult: solution,
    };
  }
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
