export class MapboxConfigurationError extends Error {
  override name = "MapboxConfigurationError";
}

export class MapboxApiError extends Error {
  override name = "MapboxApiError";

  constructor(
    message: string,
    readonly statusCode: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
