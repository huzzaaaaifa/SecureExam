import express from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { db } from '../db/db.js';
import { clearPendingLoginOtp, mfaPlaceholderSecret } from '../services/loginMfaOtp.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { auditLog } from '../services/audit.js';

// File purpose: Admin endpoints (user management, audit log) with strict RBAC.

export const adminRouter = express.Router();

const userIdParamSchema = z.coerce.number().int().positive();

const updateUserSchema = z
  .object({
    role: z.enum(['student', 'instructor', 'admin']).optional(),
    isActive: z.boolean().optional()
  })
  .refine((body) => body.role !== undefined || body.isActive !== undefined, {
    message: 'At least one of role, isActive is required'
  });

const createUserSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(128),
  role: z.enum(['student', 'instructor', 'admin'])
});

// Creates a user with any role (administrators only; passwords stored as Argon2id only).
adminRouter.post('/users', requireAuth, requireRole('admin'), validateBody(createUserSchema), async (req, res, next) => {
  try {
    const { email, password, role } = req.body;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const stmt = db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)');
    const info = stmt.run(email.toLowerCase(), passwordHash, role);

    auditLog({
      actorUserId: req.user.id,
      actorRole: req.user.role,
      action: 'admin_create_user',
      resourceType: 'user',
      resourceId: String(info.lastInsertRowid),
      outcome: 'allow',
      ip: req.ip,
      userAgent: req.get('user-agent'),
      details: { email: email.toLowerCase(), role }
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

// Lists all accounts for administrators (no password material).
adminRouter.get('/users', requireAuth, requireRole('admin'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.role,
              u.is_active AS isActive,
              u.lock_until_utc AS lockUntilUtc,
              u.failed_login_attempts AS failedLoginAttempts,
              u.created_at_utc AS createdAtUtc,
              COALESCE(m.enabled, 0) AS mfaEnabled
       FROM users u
       LEFT JOIN user_mfa m ON m.user_id = u.id
       ORDER BY u.id ASC`
    )
    .all();

  auditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'view_user_directory',
    resourceType: 'user',
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  res.json({ users: rows });
});

// Enables web-OTP MFA for another user (sign-in shows in-app code after password).
adminRouter.post('/users/:id/mfa-provision', requireAuth, requireRole('admin'), (req, res) => {
  const parseId = userIdParamSchema.safeParse(req.params.id);
  if (!parseId.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }
  const targetId = parseId.data;
  const target = db.prepare('SELECT id, email FROM users WHERE id = ?').get(targetId);
  if (!target) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  db.prepare(
    `INSERT INTO user_mfa (user_id, secret_b32, enabled) VALUES (?, ?, 1)
     ON CONFLICT(user_id) DO UPDATE SET secret_b32 = excluded.secret_b32, enabled = 1`
  ).run(targetId, mfaPlaceholderSecret());

  auditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'admin_mfa_enable_otp',
    resourceType: 'user',
    resourceId: String(targetId),
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent'),
    details: { targetEmail: target.email }
  });

  res.json({ ok: true });
});

// Removes MFA enrollment for any user (support / offboarding).
adminRouter.post('/users/:id/mfa-clear', requireAuth, requireRole('admin'), (req, res) => {
  const parseId = userIdParamSchema.safeParse(req.params.id);
  if (!parseId.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }
  const targetId = parseId.data;
  const target = db.prepare('SELECT id, email FROM users WHERE id = ?').get(targetId);
  if (!target) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  clearPendingLoginOtp(targetId);
  db.prepare('DELETE FROM user_mfa WHERE user_id = ?').run(targetId);

  auditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'admin_mfa_clear',
    resourceType: 'user',
    resourceId: String(targetId),
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent'),
    details: { targetEmail: target.email }
  });

  res.json({ ok: true });
});

// Returns active students for instructors/admins to use in exam assignment.
adminRouter.get('/users/students', requireAuth, requireRole('instructor', 'admin'), (req, res) => {
  const rows = db.prepare(
    `SELECT id, email FROM users WHERE role = 'student' AND is_active = 1 ORDER BY email ASC`
  ).all();
  res.json({ students: rows });
});

// Security / anomaly alerts (lockouts, repeated failures) for administrator review.
adminRouter.get('/security-alerts', requireAuth, requireRole('admin'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, ts_utc AS tsUtc, type, details_json AS detailsJson, ip, acknowledged
       FROM security_alerts
       ORDER BY id DESC
       LIMIT 100`
    )
    .all();

  auditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'view_security_alerts',
    resourceType: 'security_alert',
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  res.json({ alerts: rows });
});

// Returns recent audit records only to admins and logs the audit access itself.
adminRouter.get('/audit', requireAuth, requireRole('admin'), (req, res) => {
  const rows = db.prepare(
    `SELECT id, ts_utc AS tsUtc, actor_user_id AS actorUserId, actor_role AS actorRole,
            action, resource_type AS resourceType, resource_id AS resourceId,
            outcome, ip, user_agent AS userAgent, prev_hash AS prevHash, hash
     FROM audit_log
     ORDER BY id DESC
     LIMIT 200`
  ).all();

  auditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'view_audit_log',
    resourceType: 'audit_log',
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  res.json({ audit: rows });
});

// Updates a user's role and/or active flag; prevents self-lockout and removal of the last active admin.
adminRouter.patch(
  '/users/:id',
  requireAuth,
  requireRole('admin'),
  validateBody(updateUserSchema),
  (req, res) => {
    const parseId = userIdParamSchema.safeParse(req.params.id);
    if (!parseId.success) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    const targetId = parseId.data;
    const target = db
      .prepare(
        'SELECT id, email, role, is_active AS isActive FROM users WHERE id = ?'
      )
      .get(targetId);

    if (!target) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const newRole = req.body.role ?? target.role;
    const newActive = req.body.isActive !== undefined ? req.body.isActive : Boolean(target.isActive);

    if (req.user.id === targetId) {
      if (req.body.isActive === false) {
        res.status(400).json({ error: 'You cannot deactivate your own account.' });
        return;
      }
      if (req.body.role && req.body.role !== target.role) {
        res.status(400).json({ error: 'You cannot change your own role.' });
        return;
      }
    }

    const wasActiveAdmin = target.role === 'admin' && target.isActive;
    const willBeActiveAdmin = newRole === 'admin' && newActive;
    if (wasActiveAdmin && !willBeActiveAdmin) {
      const { count } = db
        .prepare(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1`)
        .get();
      if (count < 2) {
        res.status(400).json({ error: 'Cannot remove the last active administrator.' });
        return;
      }
    }

    if (newActive && !target.isActive) {
      db.prepare(
        `UPDATE users
         SET role = ?, is_active = 1, failed_login_attempts = 0, lock_until_utc = NULL
         WHERE id = ?`
      ).run(newRole, targetId);
    } else {
      db.prepare('UPDATE users SET role = ?, is_active = ? WHERE id = ?').run(newRole, newActive ? 1 : 0, targetId);
    }

    auditLog({
      actorUserId: req.user.id,
      actorRole: req.user.role,
      action: 'admin_update_user',
      resourceType: 'user',
      resourceId: String(targetId),
      outcome: 'allow',
      ip: req.ip,
      userAgent: req.get('user-agent'),
      details: {
        email: target.email,
        from: { role: target.role, isActive: Boolean(target.isActive) },
        to: { role: newRole, isActive: newActive }
      }
    });

    res.json({ ok: true, id: targetId, role: newRole, isActive: newActive });
  }
);
