import express from 'express';
import argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db/db.js';
import { config } from '../config.js';
import { validateBody } from '../middleware/validate.js';
import {
  forgotPasswordLimiter,
  loginLimiter,
  mfaPreviewLimiter,
  registerLimiter,
  resetPasswordLimiter
} from '../middleware/rateLimiters.js';
import { requireAuth } from '../middleware/auth.js';
import {
  issueAccessToken,
  issueMfaChallengeToken,
  issuePasswordResetToken,
  verifyMfaChallengeToken,
  verifyPasswordResetToken
} from '../services/jwt.js';
import { auditLog } from '../services/audit.js';
import { insertSecurityAlert } from '../services/securityAlerts.js';
import {
  clearPendingLoginOtp,
  clearPendingPasswordResetOtp,
  generateLoginOtpCode,
  getPendingLoginOtp,
  getPendingPasswordResetOtp,
  mfaPlaceholderSecret,
  otpCodesEqual,
  setPendingLoginOtp,
  setPendingPasswordResetOtp
} from '../services/loginMfaOtp.js';

// File purpose: Authentication endpoints (register/login/MFA) with defensive controls.
// Second factor uses a server-generated one-time code bound to the MFA challenge JWT (user-specific).

export const authRouter = express.Router();

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(128)
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128)
});

const mfaCompleteSchema = z.object({
  mfaToken: z.string().min(20),
  code: z.string().min(6).max(12)
});

const mfaPreviewSchema = z.object({
  mfaToken: z.string().min(20)
});

const forgotPasswordSchema = z.object({
  email: z.string().email().max(254)
});

const forgotPasswordMfaPreviewSchema = z.object({
  resetToken: z.string().min(20)
});

const resetPasswordSchema = z.object({
  resetToken: z.string().min(20),
  newPassword: z.string().min(10).max(128),
  code: z.string().min(6).max(12).optional()
});

const FORGOT_PASSWORD_ROLES = new Set(['student', 'instructor', 'admin']);

function canUseForgotPassword(role) {
  return FORGOT_PASSWORD_ROLES.has(role);
}

function passwordResetJtiConsumed(jti) {
  return Boolean(db.prepare('SELECT 1 FROM password_reset_consumed WHERE jti = ?').get(jti));
}

function consumePasswordResetJti(jti) {
  db.prepare('INSERT INTO password_reset_consumed (jti, used_at_utc) VALUES (?, ?)').run(jti, utcNow());
}

function utcNow() {
  return new Date().toISOString();
}

function addMinutesUtc(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}

function canSelfServiceMfa(role) {
  return role === 'instructor' || role === 'admin';
}

function denyLogin({ res, req, user, reason }) {
  auditLog({
    actorUserId: user?.id ?? null,
    actorRole: user?.role ?? null,
    action: 'login',
    resourceType: 'user',
    resourceId: user?.id ? String(user.id) : null,
    outcome: 'deny',
    ip: req.ip,
    userAgent: req.get('user-agent'),
    details: { reason }
  });
  res.status(401).json({ error: 'Invalid credentials' });
}

// Registers a student account (role fixed server-side; not client-selectable).
authRouter.post('/register', registerLimiter, validateBody(registerSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const role = 'student';
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const stmt = db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)');
    const info = stmt.run(email.toLowerCase(), passwordHash, role);

    auditLog({
      actorUserId: info.lastInsertRowid,
      actorRole: role,
      action: 'register',
      resourceType: 'user',
      resourceId: String(info.lastInsertRowid),
      outcome: 'allow',
      ip: req.ip,
      userAgent: req.get('user-agent'),
      details: { email: email.toLowerCase() }
    });

    res.status(201).json({ id: info.lastInsertRowid, email: email.toLowerCase(), role });
  } catch (e) {
    if (String(e?.message ?? '').includes('UNIQUE')) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    next(e);
  }
});

// Demo self-service reset: returns a short-lived resetToken (production would email a link instead).
authRouter.post('/forgot-password', forgotPasswordLimiter, validateBody(forgotPasswordSchema), async (req, res) => {
  const email = req.body.email.toLowerCase();
  await new Promise((r) => setTimeout(r, randomInt(50, 130)));

  const user = db
    .prepare('SELECT id, email, role FROM users WHERE email = ? AND is_active = 1')
    .get(email);

  if (!user || !canUseForgotPassword(user.role)) {
    res.json({ ok: true, resetToken: null, mfaRequired: false, mfaWebOtp: false });
    return;
  }

  const { token } = await issuePasswordResetToken({ userId: user.id });
  const mfa = db.prepare('SELECT enabled FROM user_mfa WHERE user_id = ?').get(user.id);

  if (mfa?.enabled === 1) {
    const otp = generateLoginOtpCode();
    setPendingPasswordResetOtp(user.id, otp, addMinutesUtc(utcNow(), 10));
    auditLog({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'password_reset_request',
      resourceType: 'user',
      resourceId: String(user.id),
      outcome: 'allow',
      ip: req.ip,
      userAgent: req.get('user-agent'),
      details: { mfaRequired: true }
    });
    res.json({ ok: true, resetToken: token, mfaRequired: true, mfaWebOtp: true });
    return;
  }

  clearPendingPasswordResetOtp(user.id);
  auditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'password_reset_request',
    resourceType: 'user',
    resourceId: String(user.id),
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent'),
    details: { mfaRequired: false }
  });
  res.json({ ok: true, resetToken: token, mfaRequired: false, mfaWebOtp: false });
});

// Dev-style preview of the reset OTP bound to the reset JWT (same pattern as login MFA preview).
authRouter.post(
  '/forgot-password/mfa-preview',
  mfaPreviewLimiter,
  validateBody(forgotPasswordMfaPreviewSchema),
  async (req, res) => {
    try {
      const { userId, jti } = await verifyPasswordResetToken(req.body.resetToken);
      if (passwordResetJtiConsumed(jti)) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }
      const row = db.prepare('SELECT enabled FROM user_mfa WHERE user_id = ?').get(userId);
      if (!row || row.enabled !== 1) {
        res.status(400).json({ error: 'Invalid request' });
        return;
      }
      const pending = getPendingPasswordResetOtp(userId);
      if (!pending || pending.expiresAtUtc < utcNow()) {
        res.status(400).json({ error: 'No active reset code. Request forgot-password again.' });
        return;
      }
      res.json({ code: pending.code });
    } catch {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  }
);

authRouter.post('/reset-password', resetPasswordLimiter, validateBody(resetPasswordSchema), async (req, res, next) => {
  const { resetToken, newPassword, code } = req.body;
  let userId;
  let jti;
  try {
    ({ userId, jti } = await verifyPasswordResetToken(resetToken));
  } catch {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  try {
    if (passwordResetJtiConsumed(jti)) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = db.prepare('SELECT id, email, role, is_active FROM users WHERE id = ?').get(userId);
    if (!user || user.is_active !== 1 || !canUseForgotPassword(user.role)) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const mfa = db.prepare('SELECT enabled FROM user_mfa WHERE user_id = ?').get(userId);
    const mfaOn = mfa?.enabled === 1;

    if (mfaOn) {
      const trimmed = String(code ?? '').trim();
      if (!trimmed) {
        res.status(400).json({ error: 'One-time code required' });
        return;
      }
      const pending = getPendingPasswordResetOtp(userId);
      if (!pending || pending.expiresAtUtc < utcNow()) {
        res.status(400).json({ error: 'Reset code expired. Request forgot-password again.' });
        return;
      }
      if (!otpCodesEqual(pending.code, trimmed)) {
        auditLog({
          actorUserId: userId,
          actorRole: user.role,
          action: 'password_reset_complete',
          resourceType: 'user',
          resourceId: String(userId),
          outcome: 'deny',
          ip: req.ip,
          userAgent: req.get('user-agent'),
          details: { reason: 'mfa_failed' }
        });
        res.status(400).json({ error: 'Invalid credentials' });
        return;
      }
    } else {
      clearPendingPasswordResetOtp(userId);
    }

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    db.prepare('UPDATE users SET password_hash = ?, failed_login_attempts = 0, lock_until_utc = NULL WHERE id = ?').run(
      passwordHash,
      userId
    );
    consumePasswordResetJti(jti);
    clearPendingPasswordResetOtp(userId);
    clearPendingLoginOtp(userId);

    auditLog({
      actorUserId: userId,
      actorRole: user.role,
      action: 'password_reset_complete',
      resourceType: 'user',
      resourceId: String(userId),
      outcome: 'allow',
      ip: req.ip,
      userAgent: req.get('user-agent'),
      details: { mfa: mfaOn }
    });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Returns the pending login OTP for this MFA challenge only (JWT identifies the user).
authRouter.post('/login/mfa-preview', mfaPreviewLimiter, validateBody(mfaPreviewSchema), async (req, res) => {
  try {
    const { userId } = await verifyMfaChallengeToken(req.body.mfaToken);
    const row = db.prepare('SELECT enabled FROM user_mfa WHERE user_id = ?').get(userId);
    if (!row || row.enabled !== 1) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    const pending = getPendingLoginOtp(userId);
    if (!pending || pending.expiresAtUtc < utcNow()) {
      res.status(400).json({ error: 'No active sign-in code. Return to password sign-in.' });
      return;
    }
    res.json({ code: pending.code });
  } catch {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Second step: verify server-issued OTP for the user bound to mfaToken.
authRouter.post('/login/mfa', loginLimiter, validateBody(mfaCompleteSchema), async (req, res, next) => {
  try {
    const { mfaToken, code } = req.body;
    const { userId, role } = await verifyMfaChallengeToken(mfaToken);
    const row = db.prepare('SELECT enabled FROM user_mfa WHERE user_id = ?').get(userId);
    if (!row || row.enabled !== 1) {
      denyLogin({ res, req, user: { id: userId, role }, reason: 'mfa_not_configured' });
      return;
    }
    const pending = getPendingLoginOtp(userId);
    if (!pending || pending.expiresAtUtc < utcNow()) {
      denyLogin({ res, req, user: { id: userId, role }, reason: 'mfa_otp_expired' });
      return;
    }
    if (!otpCodesEqual(pending.code, String(code).trim())) {
      denyLogin({ res, req, user: { id: userId, role }, reason: 'mfa_failed' });
      return;
    }

    clearPendingLoginOtp(userId);

    const accessToken = await issueAccessToken({ userId, role });
    auditLog({
      actorUserId: userId,
      actorRole: role,
      action: 'login',
      resourceType: 'user',
      resourceId: String(userId),
      outcome: 'allow',
      ip: req.ip,
      userAgent: req.get('user-agent'),
      details: { mfa: true, method: 'web_otp' }
    });

    res.json({ accessToken, tokenType: 'Bearer', expiresInSeconds: config.jwt.accessTtlSeconds, role });
  } catch {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Turns on MFA for the signed-in account (instructors/admins only; students are managed by admins).
authRouter.post('/mfa/enable-otp', requireAuth, (req, res) => {
  if (!canSelfServiceMfa(req.user.role)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const mfaFiller = mfaPlaceholderSecret();
  db.prepare(
    `INSERT INTO user_mfa (user_id, secret_b32, enabled) VALUES (?, ?, 1)
     ON CONFLICT(user_id) DO UPDATE SET secret_b32 = excluded.secret_b32, enabled = 1`
  ).run(req.user.id, mfaFiller);

  auditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'mfa_enable_otp',
    resourceType: 'user',
    resourceId: String(req.user.id),
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  res.json({ ok: true });
});

// Removes MFA enrollment for the signed-in user (instructors/admins only).
authRouter.post('/mfa/disable', requireAuth, (req, res) => {
  if (!canSelfServiceMfa(req.user.role)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  clearPendingLoginOtp(req.user.id);
  db.prepare('DELETE FROM user_mfa WHERE user_id = ?').run(req.user.id);
  auditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'mfa_disable',
    resourceType: 'user',
    resourceId: String(req.user.id),
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  res.json({ ok: true });
});

// Returns whether MFA is enabled (no OTP material). Students may see status but cannot self-enroll.
authRouter.get('/mfa/status', requireAuth, (req, res) => {
  const row = db.prepare('SELECT enabled FROM user_mfa WHERE user_id = ?').get(req.user.id);
  res.json({ enabled: Boolean(row?.enabled), eligible: canSelfServiceMfa(req.user.role) });
});

// Authenticates a user with lockout/rate-limit support; MFA uses web-delivered OTP when enabled.
authRouter.post('/login', loginLimiter, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = db
      .prepare(
        'SELECT id, email, password_hash, role, is_active, failed_login_attempts, lock_until_utc FROM users WHERE email = ?'
      )
      .get(email.toLowerCase());

    if (!user || user.is_active !== 1) return denyLogin({ res, req, user, reason: 'no_such_user_or_inactive' });
    if (user.lock_until_utc && user.lock_until_utc > utcNow()) return denyLogin({ res, req, user, reason: 'locked' });

    const ok = await argon2.verify(user.password_hash, password);
    if (!ok) {
      const newFails = Number(user.failed_login_attempts ?? 0) + 1;
      const lockUntil =
        newFails >= config.security.loginMaxAttempts ? addMinutesUtc(utcNow(), config.security.lockoutMinutes) : null;
      db.prepare('UPDATE users SET failed_login_attempts = ?, lock_until_utc = ? WHERE id = ?').run(newFails, lockUntil, user.id);

      if (newFails >= 3) {
        insertSecurityAlert({
          type: 'repeated_login_failures',
          details: { userId: user.id, email: user.email, attempts: newFails },
          ip: req.ip
        });
      }
      if (lockUntil) {
        insertSecurityAlert({
          type: 'account_locked',
          details: { userId: user.id, email: user.email, lockUntilUtc: lockUntil },
          ip: req.ip
        });
      }

      return denyLogin({ res, req, user, reason: 'bad_password' });
    }

    db.prepare('UPDATE users SET failed_login_attempts = 0, lock_until_utc = NULL WHERE id = ?').run(user.id);

    const mfa = db.prepare('SELECT enabled FROM user_mfa WHERE user_id = ?').get(user.id);
    if (mfa?.enabled === 1) {
      const otp = generateLoginOtpCode();
      const exp = addMinutesUtc(utcNow(), 3);
      setPendingLoginOtp(user.id, otp, exp);
      const mfaToken = await issueMfaChallengeToken({ userId: user.id, role: user.role });
      res.json({
        mfaRequired: true,
        mfaToken,
        expiresInSeconds: 180,
        role: user.role,
        mfaWebOtp: true
      });
      return;
    }

    const accessToken = await issueAccessToken({ userId: user.id, role: user.role });
    auditLog({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'login',
      resourceType: 'user',
      resourceId: String(user.id),
      outcome: 'allow',
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({ accessToken, tokenType: 'Bearer', expiresInSeconds: config.jwt.accessTtlSeconds, role: user.role });
  } catch (e) {
    next(e);
  }
});
