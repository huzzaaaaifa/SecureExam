// File purpose: Pure utility functions shared across components.

// Converts a datetime-local string to an ISO UTC string; throws on invalid input.
export function toUtcIso(localDateTime: string): string {
  if (!localDateTime) throw new RangeError('Date/time value is required.');
  const date = new Date(localDateTime);
  if (isNaN(date.getTime())) throw new RangeError('Invalid date/time value.');
  return date.toISOString();
}

// Generates a cryptographically random nonce for replay protection on submissions.
export function createNonce(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
