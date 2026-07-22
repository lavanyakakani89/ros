export class MapboxConfigurationError extends Error {
}

export class MapboxApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
