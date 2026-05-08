import express from 'express';
import { z } from 'zod';
import { db } from '../db/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { submitLimiter } from '../middleware/rateLimiters.js';
import { auditLog } from '../services/audit.js';
import { sha256Hex } from '../services/crypto.js';
import { computeAutoScore } from '../services/scoring.js';

// File purpose: Secure submission endpoints with replay prevention and integrity hashing.

export const submissionsRouter = express.Router();

const submitSchema = z.object({
  examId: z.number().int().positive(),
  nonce: z.string().min(16).max(128),
  answers: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]))
});

function nowIso() {
  return new Date().toISOString();
}

function isWithin(exam) {
  const now = nowIso();
  return exam.starts_at_utc <= now && now <= exam.ends_at_utc;
}

submissionsRouter.post(
  '/',
  submitLimiter,
  requireAuth,
  requireRole('student'),
  validateBody(submitSchema),
  (req, res) => {
    const { examId, nonce, answers } = req.body;

    const assigned = db
      .prepare('SELECT 1 FROM exam_assignments WHERE exam_id = ? AND student_user_id = ?')
      .get(examId, req.user.id);
    if (!assigned) {
      auditLog({
        actorUserId: req.user.id,
        actorRole: req.user.role,
        action: 'submit_answers',
        resourceType: 'submission',
        resourceId: String(examId),
        outcome: 'deny',
        ip: req.ip,
        userAgent: req.get('user-agent'),
        details: { reason: 'not_assigned' }
      });
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const exam = db
      .prepare(
        'SELECT id, starts_at_utc, ends_at_utc, questions_json, COALESCE(archived, 0) AS archived FROM exams WHERE id = ?'
      )
      .get(examId);
    if (!exam || exam.archived) {
      auditLog({
        actorUserId: req.user.id,
        actorRole: req.user.role,
        action: 'submit_answers',
        resourceType: 'submission',
        resourceId: String(examId),
        outcome: 'deny',
        ip: req.ip,
        userAgent: req.get('user-agent'),
        details: { reason: exam ? 'archived' : 'not_found' }
      });
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    if (!isWithin(exam)) {
      auditLog({
        actorUserId: req.user.id,
        actorRole: req.user.role,
        action: 'submit_answers',
        resourceType: 'submission',
        resourceId: String(examId),
        outcome: 'deny',
        ip: req.ip,
        userAgent: req.get('user-agent'),
        details: { reason: 'outside_time_window' }
      });
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const existing = db.prepare('SELECT id FROM submissions WHERE exam_id = ? AND student_user_id = ?').get(examId, req.user.id);
    if (existing) {
      auditLog({
        actorUserId: req.user.id,
        actorRole: req.user.role,
        action: 'submit_answers',
        resourceType: 'submission',
        resourceId: String(existing.id),
        outcome: 'deny',
        ip: req.ip,
        userAgent: req.get('user-agent'),
        details: { reason: 'duplicate_attempt' }
      });
      res.status(409).json({ error: 'Submission already exists' });
      return;
    }

    const canonical = JSON.stringify({ examId, studentUserId: req.user.id, nonce, answers });
    const integrityHash = sha256Hex(canonical);
    const score = computeAutoScore(exam.questions_json, answers);

    try {
      const info = db
        .prepare(
          `INSERT INTO submissions (exam_id, student_user_id, nonce, integrity_hash, answers_json)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(examId, req.user.id, nonce, integrityHash, JSON.stringify(answers));

      db.prepare(
        `INSERT INTO results (exam_id, student_user_id, score, published)
         VALUES (?, ?, ?, 0)
         ON CONFLICT(exam_id, student_user_id) DO UPDATE SET
           score = excluded.score,
           updated_at_utc = excluded.updated_at_utc,
           published = 0`
      ).run(examId, req.user.id, score);

      auditLog({
        actorUserId: req.user.id,
        actorRole: req.user.role,
        action: 'submit_answers',
        resourceType: 'submission',
        resourceId: String(info.lastInsertRowid),
        outcome: 'allow',
        ip: req.ip,
        userAgent: req.get('user-agent'),
        details: { examId, integrityHash, autoScore: score }
      });

      res.status(201).json({ id: info.lastInsertRowid, integrityHash, score });
    } catch (e) {
      const msg = String(e?.message ?? '');
      if (msg.includes('UNIQUE')) {
        res.status(409).json({ error: 'Duplicate submission' });
        return;
      }
      throw e;
    }
  }
);

submissionsRouter.get('/me', requireAuth, requireRole('student'), (req, res) => {
  const rows = db.prepare(
    `SELECT s.id, s.exam_id AS examId, s.submitted_at_utc AS submittedAtUtc, s.integrity_hash AS integrityHash
     FROM submissions s
     WHERE s.student_user_id = ?
     ORDER BY s.submitted_at_utc DESC`
  ).all(req.user.id);

  auditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'list_my_submissions',
    resourceType: 'submission',
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  res.json({ submissions: rows });
});
