import type { RoutingCoordinate } from "../../modules/delivery-routing/providers/route-optimization.provider.js";
import { MapboxClient } from "./mapbox.client.js";

interface MapboxMatrixResponse {
  durations?: Array<Array<number | null>>;
  distances?: Array<Array<number | null>>;
}

export class MapboxMatrixProvider {
  constructor(private readonly client = new MapboxClient()) {}

  async getMatrix(input: {
    profile: string;
    coordinates: RoutingCoordinate[];
    annotations?: "duration" | "distance" | "duration,distance";
  }): Promise<MapboxMatrixResponse> {
    const coordinates = input.coordinates.map((coordinate) => `${String(coordinate.longitude)},${String(coordinate.latitude)}`).join(";");
    return this.client.get<MapboxMatrixResponse>(`/directions-matrix/v1/${input.profile}/${coordinates}`, {
      annotations: input.annotations ?? "duration,distance",
    });
  }
}
