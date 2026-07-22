import type {
  RouteGeometryInput,
  RouteGeometryProvider,
  RouteGeometryResult,
} from "../../modules/delivery-routing/providers/route-optimization.provider.js";
import { getMapboxConfig, MapboxClient } from "./mapbox.client.js";

interface MapboxDirectionsResponse {
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: unknown;
  }>;
  code?: string;
  message?: string;
}

export class MapboxDirectionsProvider implements RouteGeometryProvider {
  private readonly config = getMapboxConfig();

  constructor(private readonly client = new MapboxClient()) {}

  async getGeometry(input: RouteGeometryInput): Promise<RouteGeometryResult | null> {
    if (input.coordinates.length < 2) {
      return null;
    }
    if (!Number.isInteger(this.config.maxDirectionsCoordinates) || this.config.maxDirectionsCoordinates < 2 || this.config.maxDirectionsCoordinates > 25) {
      throw new Error("Mapbox Directions supports between 2 and 25 coordinates per request.");
    }

    const chunks = chunkCoordinates(input.coordinates, this.config.maxDirectionsCoordinates);
    const geometries: unknown[] = [];
    let distanceMeters = 0;
    let durationSeconds = 0;
    const rawResponses: unknown[] = [];

    for (const chunk of chunks) {
      const coordinates = chunk.map((coordinate) => `${String(coordinate.longitude)},${String(coordinate.latitude)}`).join(";");
      const response = await this.client.get<MapboxDirectionsResponse>(`/directions/v5/${input.profile}/${coordinates}`, {
        geometries: "geojson",
        overview: "full",
        steps: false,
      });
      rawResponses.push(response);

      const route = response.routes?.[0];
      if (!route?.geometry) {
        continue;
      }

      geometries.push(route.geometry);
      distanceMeters += route.distance ?? 0;
      durationSeconds += route.duration ?? 0;
    }

    if (geometries.length === 0) {
      return null;
    }

    return {
      provider: "mapbox-directions",
      geometry: geometries.length === 1 ? geometries[0] : { type: "GeometryCollection", geometries },
      distanceMeters: Math.round(distanceMeters),
      durationSeconds: Math.round(durationSeconds),
      rawResponse: rawResponses,
    };
  }
}

function chunkCoordinates<T>(coordinates: T[], maxPerRequest: number): T[][] {
  if (maxPerRequest < 2) {
    throw new Error("Directions coordinate chunks require at least 2 coordinates.");
  }

  if (coordinates.length <= maxPerRequest) {
    return [coordinates];
  }

  const chunks: T[][] = [];
  let index = 0;
  while (index < coordinates.length) {
    const end = Math.min(coordinates.length, index + maxPerRequest);
    chunks.push(coordinates.slice(index, end));
    index = end - 1;
  }

  return chunks;
}
