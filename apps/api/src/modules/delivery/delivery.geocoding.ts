import type { FastifyBaseLogger } from "fastify";

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  provider: string;
}

export async function geocodeAddress(address: string, logger: FastifyBaseLogger): Promise<GeocodeResult | null> {
  const baseUrl = process.env.GEOCODER_BASE_URL?.replace(/\/+$/, "");
  if (!baseUrl) {
    return null;
  }

  const url = new URL(baseUrl);
  url.searchParams.set("q", `${address}, India`);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "RetailOS/0.1 delivery-geocoder",
      },
    });

    if (!response.ok) {
      return null;
    }

    const body = await response.json() as Array<{ lat?: string; lon?: string }>;
    const first = body[0];
    if (!first?.lat || !first.lon) {
      return null;
    }

    return {
      latitude: Number(first.lat),
      longitude: Number(first.lon),
      provider: "nominatim",
    };
  } catch (error) {
    logger.warn({ error, address }, "Delivery geocoding failed");
    return null;
  }
}
