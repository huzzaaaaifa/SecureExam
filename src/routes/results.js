import express from 'express';
import { db } from '../db/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { auditLog } from '../services/audit.js';

// File purpose: Student-facing published results only (no drafts or other students' data).

export const resultsRouter = express.Router();

// Lists published scores for the signed-in student (assigned exams / own submissions only via results row).
resultsRouter.get('/me', requireAuth, requireRole('student'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.exam_id AS examId,
              e.title AS examTitle,
              r.score,
              r.updated_at_utc AS updatedAtUtc
       FROM results r
       JOIN exams e ON e.id = r.exam_id
       WHERE r.student_user_id = ? AND r.published = 1
       ORDER BY r.updated_at_utc DESC`
    )
    .all(req.user.id);

  auditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'list_my_published_results',
    resourceType: 'result',
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  res.json({ results: rows });
});
