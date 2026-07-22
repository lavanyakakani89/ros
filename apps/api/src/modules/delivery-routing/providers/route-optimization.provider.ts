export interface RoutingCoordinate {
  longitude: number;
  latitude: number;
}

export interface GeocodeInput {
  tenantId: string;
  query: string;
  proximity?: RoutingCoordinate | undefined;
}

export interface GeocodeResult {
  provider: string;
  providerResultId?: string | undefined;
  query: string;
  formattedAddress: string;
  coordinate: RoutingCoordinate;
  accuracy?: string | undefined;
  confidence?: number | undefined;
  rawResponse?: unknown;
}

export interface GeocodingProvider {
  geocode(input: GeocodeInput): Promise<GeocodeResult | null>;
}

export interface RouteOptimizationLocation {
  id: string;
  name: string;
  coordinate: RoutingCoordinate;
}

export interface RouteOptimizationVehicle {
  id: string;
  name: string;
  driverId?: string | undefined;
  startLocationId: string;
  endLocationId?: string | undefined;
  routingProfile: string;
}

export interface RouteOptimizationServiceStop {
  id: string;
  deliveryId: string;
  locationId: string;
  durationSeconds: number;
  lockedSequence?: number | undefined;
}

export interface RouteOptimizationInput {
  routePlanId: string;
  locations: RouteOptimizationLocation[];
  vehicles: RouteOptimizationVehicle[];
  services: RouteOptimizationServiceStop[];
  objective: "min-total-travel-duration" | "min-schedule-completion-time";
}

export interface RouteOptimizationSubmitResult {
  provider: string;
  providerJobId: string;
  rawRequest?: unknown;
}

export type RouteOptimizationResultStatus = "processing" | "complete" | "failed";

export interface RouteOptimizationResultStop {
  serviceId: string;
  deliveryId?: string | undefined;
  locationId: string;
  eta?: string | undefined;
  sequence: number;
  durationSeconds?: number | undefined;
  waitSeconds?: number | undefined;
  odometerMeters?: number | undefined;
}

export interface RouteOptimizationResultRoute {
  vehicleId: string;
  driverId?: string | undefined;
  stops: RouteOptimizationResultStop[];
  distanceMeters?: number | undefined;
  durationSeconds?: number | undefined;
}

export interface RouteOptimizationResult {
  status: RouteOptimizationResultStatus;
  routes: RouteOptimizationResultRoute[];
  droppedServiceIds: string[];
  rawResult?: unknown;
  error?: string | undefined;
}

export interface RouteOptimizationProvider {
  submit(input: RouteOptimizationInput): Promise<RouteOptimizationSubmitResult>;
  getResult(providerJobId: string): Promise<RouteOptimizationResult>;
}

export interface RouteGeometryInput {
  profile: string;
  coordinates: RoutingCoordinate[];
}

export interface RouteGeometryResult {
  provider: string;
  geometry: unknown;
  distanceMeters?: number | undefined;
  durationSeconds?: number | undefined;
  rawResponse?: unknown;
}

export interface RouteGeometryProvider {
  getGeometry(input: RouteGeometryInput): Promise<RouteGeometryResult | null>;
}
