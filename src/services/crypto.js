import crypto from 'node:crypto';

// Returns a SHA-256 hash used for submission integrity and audit chaining.
export function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Generates unpredictable identifiers/nonces when server-side random values are needed.
export function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

