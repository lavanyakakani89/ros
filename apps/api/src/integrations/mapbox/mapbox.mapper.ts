import type { RoutingCoordinate } from "../../modules/delivery-routing/providers/route-optimization.provider.js";

export function toMapboxCoordinate(coordinate: RoutingCoordinate): [number, number] {
  return [coordinate.longitude, coordinate.latitude];
}

export function toMapboxCoordinateString(coordinate: RoutingCoordinate): string {
  return `${String(coordinate.longitude)},${String(coordinate.latitude)}`;
}
