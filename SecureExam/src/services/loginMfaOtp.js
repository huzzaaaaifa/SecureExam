import crypto from 'node:crypto';
import { db } from '../db/db.js';

// File purpose: Short-lived numeric OTP for the second login step (no authenticator app).

export function mfaPlaceholderSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateLoginOtpCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function setPendingLoginOtp(userId, code, expiresAtUtc) {
  db.prepare(
    `INSERT INTO login_mfa_pending (user_id, code, expires_at_utc) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET code = excluded.code, expires_at_utc = excluded.expires_at_utc`
  ).run(userId, code, expiresAtUtc);
}

export function clearPendingLoginOtp(userId) {
  db.prepare('DELETE FROM login_mfa_pending WHERE user_id = ?').run(userId);
}

export function getPendingLoginOtp(userId) {
  return db.prepare('SELECT code, expires_at_utc AS expiresAtUtc FROM login_mfa_pending WHERE user_id = ?').get(userId);
}

export function otpCodesEqual(expected, received) {
  const a = String(expected ?? '').trim();
  const b = String(received ?? '').trim();
  if (!/^\d{6}$/.test(a) || !/^\d{6}$/.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export function setPendingPasswordResetOtp(userId, code, expiresAtUtc) {
  db.prepare(
    `INSERT INTO password_reset_mfa_pending (user_id, code, expires_at_utc) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET code = excluded.code, expires_at_utc = excluded.expires_at_utc`
  ).run(userId, code, expiresAtUtc);
}

export function clearPendingPasswordResetOtp(userId) {
  db.prepare('DELETE FROM password_reset_mfa_pending WHERE user_id = ?').run(userId);
}

export function getPendingPasswordResetOtp(userId) {
  return db
    .prepare('SELECT code, expires_at_utc AS expiresAtUtc FROM password_reset_mfa_pending WHERE user_id = ?')
    .get(userId);
}
