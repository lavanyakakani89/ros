import type { GeocodeInput, GeocodeResult, GeocodingProvider } from "../../modules/delivery-routing/providers/route-optimization.provider.js";
import { getMapboxConfig, MapboxClient } from "./mapbox.client.js";

interface MapboxGeocodingResponse {
  features?: Array<{
    id?: string;
    geometry?: {
      coordinates?: [number, number];
    };
    properties?: {
      mapbox_id?: string;
      full_address?: string;
      name_preferred?: string;
      name?: string;
      coordinates?: {
        longitude?: number;
        latitude?: number;
        accuracy?: string;
      };
      match_code?: {
        confidence?: string;
      };
    };
    place_name?: string;
  }>;
}

export class MapboxGeocodingProvider implements GeocodingProvider {
  private readonly config = getMapboxConfig();

  constructor(private readonly client = new MapboxClient()) {}

  async geocode(input: GeocodeInput): Promise<GeocodeResult | null> {
    const response = await this.client.get<MapboxGeocodingResponse>("/search/geocode/v6/forward", {
      q: input.query,
      limit: 1,
      permanent: this.config.geocodingStorageMode === "permanent",
      ...(input.proximity ? { proximity: `${String(input.proximity.longitude)},${String(input.proximity.latitude)}` } : {}),
    });

    const feature = response.features?.[0];
    const longitude = feature?.properties?.coordinates?.longitude ?? feature?.geometry?.coordinates?.[0];
    const latitude = feature?.properties?.coordinates?.latitude ?? feature?.geometry?.coordinates?.[1];
    if (longitude === undefined || latitude === undefined) {
      return null;
    }

    return {
      provider: "mapbox",
      providerResultId: feature?.properties?.mapbox_id ?? feature?.id,
      query: input.query,
      formattedAddress: feature?.properties?.full_address ?? feature?.place_name ?? feature?.properties?.name_preferred ?? feature?.properties?.name ?? input.query,
      coordinate: {
        longitude,
        latitude,
      },
      accuracy: feature?.properties?.coordinates?.accuracy,
      confidence: confidenceToNumber(feature?.properties?.match_code?.confidence),
      ...(this.config.storeRawGeocodingResponse ? { rawResponse: response } : {}),
    };
  }
}

function confidenceToNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "exact") return 1;
  if (value === "high") return 0.85;
  if (value === "medium") return 0.6;
  if (value === "low") return 0.35;

  return undefined;
}
