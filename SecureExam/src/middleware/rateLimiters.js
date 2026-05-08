import rateLimit from 'express-rate-limit';

// File purpose: Apply rate limiting to sensitive endpoints (e.g., login).

export const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});

// Limits automated student self-registration abuse (per IP).
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});

// Limits submission spam per IP (DoS / misuse mitigation on P5 path).
export const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});

// Allows polling the dev-only MFA preview during the login step without tripping login limits.
export const mfaPreviewLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 45,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});

export const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});

export const resetPasswordLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});

