import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';

// Converts the configured JWT secret into the key format required by jose.
function secretKey() {
  return new TextEncoder().encode(config.jwt.secret);
}

const MFA_CHALLENGE_AUDIENCE = 'secureexam-mfa-challenge';
const RESET_FLOW_AUDIENCE = 'secureexam-reset-flow';
/** Short-lived password reset flow (demo: no email link; client holds this JWT until new password is set). */
export const RESET_FLOW_TTL_SECONDS = 900;

// File purpose: Issue and verify short-lived JWT access tokens + MFA challenge tokens.

// Issues a signed short-lived access token containing only minimal identity claims.
export async function issueAccessToken({ userId, role }) {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ sub: String(userId), role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setIssuer(config.jwt.issuer)
    .setAudience(config.jwt.audience)
    .setExpirationTime(now + config.jwt.accessTtlSeconds)
    .sign(secretKey());
}

// Short-lived token presented with the web OTP after password verification when MFA is on.
export async function issueMfaChallengeToken({ userId, role }) {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ sub: String(userId), role, purpose: 'mfa_challenge' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setIssuer(config.jwt.issuer)
    .setAudience(MFA_CHALLENGE_AUDIENCE)
    .setExpirationTime(now + 180)
    .sign(secretKey());
}

// Verifies signature, issuer, audience, expiry, and MFA challenge purpose.
export async function verifyMfaChallengeToken(token) {
  const { payload } = await jwtVerify(token, secretKey(), {
    issuer: config.jwt.issuer,
    audience: MFA_CHALLENGE_AUDIENCE
  });
  if (payload.purpose !== 'mfa_challenge') {
    throw new Error('Invalid token');
  }
  return { userId: Number(payload.sub), role: String(payload.role) };
}

export async function issuePasswordResetToken({ userId }) {
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ sub: String(userId), purpose: 'password_reset', jti })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setIssuer(config.jwt.issuer)
    .setAudience(RESET_FLOW_AUDIENCE)
    .setExpirationTime(now + RESET_FLOW_TTL_SECONDS)
    .sign(secretKey());
  return { token, jti };
}

export async function verifyPasswordResetToken(token) {
  const { payload } = await jwtVerify(token, secretKey(), {
    issuer: config.jwt.issuer,
    audience: RESET_FLOW_AUDIENCE
  });
  if (payload.purpose !== 'password_reset') {
    throw new Error('Invalid token');
  }
  const jti = String(payload.jti ?? '');
  if (!jti) {
    throw new Error('Invalid token');
  }
  return { userId: Number(payload.sub), jti };
}

// Verifies signature, issuer, audience, and expiry before returning identity claims.
export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, secretKey(), {
    issuer: config.jwt.issuer,
    audience: config.jwt.audience
  });
  return { userId: Number(payload.sub), role: payload.role };
}

