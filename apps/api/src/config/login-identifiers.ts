export const loginIdentifierPattern = /^\S+$/;

export function normalizeLoginIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

export function defaultUsername(email: string): string {
  return normalizeLoginIdentifier(email);
}
