export interface ParsedCoordinates {
  latitude: number;
  longitude: number;
  source: "GOOGLE_MAPS_URL" | "COORDINATES";
}

const COORDINATE_PATTERN = String.raw`(-?(?:[0-8]?\d(?:\.\d+)?|90(?:\.0+)?)),\s*(-?(?:(?:1[0-7]\d|[0-9]?\d)(?:\.\d+)?|180(?:\.0+)?))`;
const AT_COORDINATE_RE = new RegExp(String.raw`@${COORDINATE_PATTERN}`);
const QUERY_COORDINATE_RE = new RegExp(String.raw`[?&](?:q|ll)=${COORDINATE_PATTERN}`);
const BANG_COORDINATE_RE = /!3d(-?(?:[0-8]?\d(?:\.\d+)?|90(?:\.0+)?))!4d(-?(?:(?:1[0-7]\d|[0-9]?\d)(?:\.\d+)?|180(?:\.0+)?))/;
const PLAIN_COORDINATE_RE = new RegExp(String.raw`^\s*${COORDINATE_PATTERN}\s*$`);

export function parseLocationCoordinates(input: string): ParsedCoordinates | null {
  const value = input.trim();
  if (!value) return null;

  const decoded = safeDecode(value);
  const source = /google\.[a-z.]+\/maps|maps\.app\.goo\.gl/i.test(decoded) ? "GOOGLE_MAPS_URL" : "COORDINATES";
  const match = BANG_COORDINATE_RE.exec(decoded) ?? AT_COORDINATE_RE.exec(decoded) ?? QUERY_COORDINATE_RE.exec(decoded) ?? PLAIN_COORDINATE_RE.exec(decoded);
  if (!match) return null;

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  return { latitude, longitude, source };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
