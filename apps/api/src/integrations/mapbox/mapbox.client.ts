import { MapboxApiError, MapboxConfigurationError } from "./mapbox.errors.js";

export interface MapboxConfig {
  enabled: boolean;
  serverAccessToken?: string | undefined;
  geocodingStorageMode: "permanent" | "temporary";
  storeRawGeocodingResponse: boolean;
  routingProfile: string;
  maxDirectionsCoordinates: number;
}

export function getMapboxConfig(): MapboxConfig {
  return {
    enabled: process.env.MAPBOX_ROUTING_ENABLED === "true",
    serverAccessToken: process.env.MAPBOX_SERVER_ACCESS_TOKEN,
    geocodingStorageMode: process.env.MAPBOX_GEOCODING_STORAGE_MODE === "temporary" ? "temporary" : "permanent",
    storeRawGeocodingResponse: process.env.MAPBOX_STORE_RAW_GEOCODING_RESPONSE === "true",
    routingProfile: process.env.MAPBOX_ROUTING_PROFILE ?? "mapbox/driving",
    maxDirectionsCoordinates: Number(process.env.MAPBOX_MAX_DIRECTIONS_COORDINATES ?? 25),
  };
}

export function validateMapboxConfiguration(): void {
  const config = getMapboxConfig();
  if (!config.enabled) {
    return;
  }

  if (!config.serverAccessToken) {
    throw new MapboxConfigurationError("MAPBOX_ROUTING_ENABLED=true requires MAPBOX_SERVER_ACCESS_TOKEN.");
  }

  if (config.geocodingStorageMode !== "permanent") {
    throw new MapboxConfigurationError("BizBil stores delivery coordinates, so MAPBOX_GEOCODING_STORAGE_MODE must be permanent.");
  }
}

export class MapboxClient {
  constructor(private readonly config: MapboxConfig = getMapboxConfig()) {}

  isConfigured(): boolean {
    return Boolean(this.config.enabled && this.config.serverAccessToken);
  }

  async get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    return this.request<T>(path, {
      method: "GET",
      params,
    });
  }

  async post<T>(path: string, body: unknown, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      params,
      body,
    });
  }

  private async request<T>(
    path: string,
    input: {
      method: "GET" | "POST";
      params?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
    },
  ): Promise<T> {
    if (!this.config.serverAccessToken) {
      throw new MapboxConfigurationError("MAPBOX_SERVER_ACCESS_TOKEN is not configured.");
    }

    const url = new URL(path, "https://api.mapbox.com");
    url.searchParams.set("access_token", this.config.serverAccessToken);
    for (const [key, value] of Object.entries(input.params ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const init: RequestInit = {
      method: input.method,
    };
    if (input.body) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(input.body);
    }

    const response = await fetch(url, init);

    const text = await response.text();
    const data = parseJson(text);
    if (!response.ok) {
      throw new MapboxApiError(`Mapbox request failed with ${String(response.status)}`, response.status, data ?? text.slice(0, 400));
    }

    return data as T;
  }
}

function parseJson(value: string): unknown {
  if (!value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
