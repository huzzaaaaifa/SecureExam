import express from 'express';
import { z } from 'zod';
import { db } from '../db/db.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { auditLog } from '../services/audit.js';

// File purpose: Exam access + management endpoints with RBAC and object-level checks.

export const examsRouter = express.Router();

function withinWindow(exam) {
  const now = new Date().toISOString();
  return exam.starts_at_utc <= now && now <= exam.ends_at_utc;
}

/** For student UI: when an assignment exists but GET /:id would reject (time window). */
function examPhase(exam) {
  const now = new Date().toISOString();
  if (now < exam.starts_at_utc) return 'upcoming';
  if (now > exam.ends_at_utc) return 'ended';
  return 'active';
}

function parseQuestionsJson(raw) {
  try {
    const q = JSON.parse(raw ?? '[]');
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

// Strips grading metadata before returning exam content to students.
function questionsForStudent(raw) {
  const arr = parseQuestionsJson(raw);
  return arr.map((q) => {
    if (q.type === 'mcq') {
      return {
        id: q.id,
        type: 'mcq',
        prompt: q.prompt ?? '',
        points: q.points ?? 0,
        options: Array.isArray(q.options) ? q.options : []
      };
    }
    return {
      id: q.id,
      type: 'text',
      prompt: q.prompt ?? '',
      points: q.points ?? 0
    };
  });
}

function assertExamResultsAccess(req, examId) {
  const exam = db
    .prepare('SELECT id, created_by_user_id, archived FROM exams WHERE id = ?')
    .get(examId);
  if (!exam) return { error: 'not_found' };
  if (req.user.role === 'admin') return { exam };
  if (req.user.role === 'instructor' && exam.created_by_user_id === req.user.id) return { exam };
  return { error: 'forbidden' };
}

function assertExamManageAccess(req, examId) {
  return assertExamResultsAccess(req, examId);
}

const questionSchema = z.object({
  id: z.string().min(1).max(32),
  type: z.enum(['text', 'mcq']),
  prompt: z.string().max(500).optional(),
  points: z.number().int().min(0).max(100).optional(),
  options: z.array(z.string().max(200)).max(12).optional(),
  correctIndex: z.number().int().min(0).optional()
});

const createExamSchema = z
  .object({
    title: z.string().min(3).max(120),
    startsAtUtc: z.string().datetime(),
    endsAtUtc: z.string().datetime(),
    questions: z.array(questionSchema).max(20).optional()
  })
  .refine((v) => v.startsAtUtc < v.endsAtUtc, { message: 'Invalid time window', path: ['endsAtUtc'] })
  .superRefine((v, ctx) => {
    if (!v.questions) return;
    for (const q of v.questions) {
      if (q.type === 'mcq') {
        if (!q.options?.length) {
          ctx.addIssue({ code: 'custom', message: 'MCQ requires options', path: ['questions'] });
          return;
        }
        if (q.correctIndex === undefined || q.correctIndex >= q.options.length) {
          ctx.addIssue({ code: 'custom', message: 'MCQ requires valid correctIndex', path: ['questions'] });
        }
      }
    }
  });

const patchExamSchema = z
  .object({
    title: z.string().min(3).max(120).optional(),
    startsAtUtc: z.string().datetime().optional(),
    endsAtUtc: z.string().datetime().optional(),
    questions: z.array(questionSchema).max(20).optional()
  })
  .refine((b) => b.title || b.startsAtUtc || b.endsAtUtc || b.questions, { message: 'No updates' })
  .superRefine((v, ctx) => {
    if (v.startsAtUtc && v.endsAtUtc && v.startsAtUtc >= v.endsAtUtc) {
      ctx.addIssue({ code: 'custom', message: 'Invalid time window', path: ['endsAtUtc'] });
    }
    if (v.questions) {
      for (const q of v.questions) {
        if (q.type === 'mcq') {
          if (!q.options?.length) ctx.addIssue({ code: 'custom', message: 'MCQ requires options', path: ['questions'] });
          if (q.correctIndex !== undefined && q.options && q.correctIndex >= q.options.length) {
            ctx.addIssue({ code: 'custom', message: 'correctIndex out of range', path: ['questions'] });
          }
        }
      }
    }
  });

const patchScoreSchema = z.object({
  score: z.number().int().min(0).max(100)
});

const publishResultsSchema = z.object({
  studentUserId: z.number().int().positive().optional()
});

// Lists exams for instructors (own, non-archived) or admins (all; ?includeArchived=1).
examsRouter.get('/', requireAuth, requireRole('instructor', 'admin'), (req, res) => {
  const includeArchived = req.user.role === 'admin' && req.query.includeArchived === '1';
  const rows =
    req.user.role === 'admin'
      ? includeArchived
        ? db
            .prepare(
              `SELECT id, title, starts_at_utc, ends_at_utc, questions_json AS questionsJson, archived
               FROM exams ORDER BY starts_at_utc DESC`
            )
            .all()
        : db
            .prepare(
              `SELECT id, title, starts_at_utc, ends_at_utc, questions_json AS questionsJson, archived
               FROM exams WHERE archived = 0 ORDER BY starts_at_utc DESC`
            )
            .all()
      : db
          .prepare(
            `SELECT id, title, starts_at_utc, ends_at_utc, questions_json AS questionsJson, archived
             FROM exams WHERE created_by_user_id = ? AND archived = 0
             ORDER BY starts_at_utc DESC`
          )
          .all(req.user.id);

  auditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'list_exams',
    resourceType: 'exam',
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  res.json({ exams: rows });
});

examsRouter.get('/assigned', requireAuth, requireRole('student'), (req, res) => {
  const rows = db.prepare(
    `SELECT e.id, e.title, e.starts_at_utc, e.ends_at_utc
     FROM exams e
     JOIN exam_assignments a ON a.exam_id = e.id
     WHERE a.student_user_id = ? AND COALESCE(e.archived, 0) = 0
     ORDER BY e.starts_at_utc ASC`
  ).all(req.user.id);

  auditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'list_assigned_exams',
    resourceType: 'exam',
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  const exams = rows.map((e) => ({ ...e, phase: examPhase(e) }));
  res.json({ exams });
});

examsRouter.get('/:examId/results', requireAuth, requireRole('instructor', 'admin'), (req, res) => {
  const examId = Number(req.params.examId);
  if (!Number.isFinite(examId) || examId <= 0) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }
  const access = assertExamResultsAccess(req, examId);
  if (access.error === 'not_found') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (access.error === 'forbidden') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const rows = db
    .prepare(
      `SELECT r.student_user_id AS studentUserId, u.email, r.score, r.published,
              r.updated_at_utc AS updatedAtUtc
       FROM results r
       JOIN users u ON u.id = r.student_user_id
       WHERE r.exam_id = ?
       ORDER BY u.email ASC`
    )
    .all(examId);

  auditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'list_exam_results',
    resourceType: 'exam',
    resourceId: String(examId),
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  res.json({ examId, results: rows });
});

// Lists submissions with answers for grading / review (instructor owner or admin).
examsRouter.get('/:examId/submissions', requireAuth, requireRole('instructor', 'admin'), (req, res) => {
  const examId = Number(req.params.examId);
  if (!Number.isFinite(examId) || examId <= 0) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }
  const access = assertExamResultsAccess(req, examId);
  if (access.error === 'not_found') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (access.error === 'forbidden') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const rows = db
    .prepare(
      `SELECT s.id, s.student_user_id AS studentUserId, u.email,
              s.submitted_at_utc AS submittedAtUtc, s.integrity_hash AS integrityHash,
              s.answers_json AS answersJson
       FROM submissions s
       JOIN users u ON u.id = s.student_user_id
       WHERE s.exam_id = ?
       ORDER BY s.submitted_at_utc ASC`
    )
    .all(examId);

  auditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'list_exam_submissions',
    resourceType: 'exam',
    resourceId: String(examId),
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  res.json({ examId, submissions: rows });
});

// Sets draft score for one student before publishing (manual grading / override).
examsRouter.patch(
  '/:examId/results/:studentUserId',
  requireAuth,
  requireRole('instructor', 'admin'),
  validateBody(patchScoreSchema),
  (req, res) => {
    const examId = Number(req.params.examId);
    const studentUserId = Number(req.params.studentUserId);
    if (!Number.isFinite(examId) || examId <= 0 || !Number.isFinite(studentUserId) || studentUserId <= 0) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    const access = assertExamResultsAccess(req, examId);
    if (access.error === 'not_found') {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (access.error === 'forbidden') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const sub = db
      .prepare('SELECT id FROM submissions WHERE exam_id = ? AND student_user_id = ?')
      .get(examId, studentUserId);
    if (!sub) {
      res.status(400).json({ error: 'No submission for this student.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE results SET score = ?, updated_at_utc = ?, published = 0
       WHERE exam_id = ? AND student_user_id = ?`
    ).run(req.body.score, now, examId, studentUserId);

    auditLog({
      actorUserId: req.user.id,
      actorRole: req.user.role,
      action: 'update_exam_result_score',
      resourceType: 'result',
      resourceId: `${examId}:${studentUserId}`,
      outcome: 'allow',
      ip: req.ip,
      userAgent: req.get('user-agent'),
      details: { score: req.body.score }
    });

    res.json({ ok: true, examId, studentUserId, score: req.body.score });
  }
);

examsRouter.post(
  '/:examId/publish-results',
  requireAuth,
  requireRole('instructor', 'admin'),
  validateBody(publishResultsSchema),
  (req, res) => {
    const examId = Number(req.params.examId);
    if (!Number.isFinite(examId) || examId <= 0) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    const access = assertExamResultsAccess(req, examId);
    if (access.error === 'not_found') {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (access.error === 'forbidden') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const { studentUserId } = req.body;
    const now = new Date().toISOString();
    let info;
    if (studentUserId !== undefined) {
      const row = db.prepare('SELECT 1 FROM results WHERE exam_id = ? AND student_user_id = ?').get(examId, studentUserId);
      if (!row) {
        res.status(400).json({ error: 'No result record for this student on this exam.' });
        return;
      }
      info = db
        .prepare(
          `UPDATE results SET published = 1, updated_at_utc = ?
           WHERE exam_id = ? AND student_user_id = ? AND published = 0`
        )
        .run(now, examId, studentUserId);
    } else {
      info = db
        .prepare(
          `UPDATE results SET published = 1, updated_at_utc = ?
           WHERE exam_id = ? AND published = 0`
        )
        .run(now, examId);
    }

    auditLog({
      actorUserId: req.user.id,
      actorRole: req.user.role,
      action: 'publish_exam_results',
      resourceType: 'exam',
      resourceId: String(examId),
      outcome: 'allow',
      ip: req.ip,
      userAgent: req.get('user-agent'),
      details: { studentUserId: studentUserId ?? null, rowsChanged: info.changes }
    });

    res.json({ ok: true, publishedCount: info.changes });
  }
);

// Updates exam metadata, schedule, or question definitions (owner or admin).
examsRouter.patch('/:examId', requireAuth, requireRole('instructor', 'admin'), validateBody(patchExamSchema), (req, res) => {
  const examId = Number(req.params.examId);
  if (!Number.isFinite(examId) || examId <= 0) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }
  const access = assertExamManageAccess(req, examId);
  if (access.error === 'not_found') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (access.error === 'forbidden') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const cur = db.prepare('SELECT title, starts_at_utc, ends_at_utc, questions_json FROM exams WHERE id = ?').get(examId);
  const title = req.body.title ?? cur.title;
  const startsAtUtc = req.body.startsAtUtc ?? cur.starts_at_utc;
  const endsAtUtc = req.body.endsAtUtc ?? cur.ends_at_utc;
  if (startsAtUtc >= endsAtUtc) {
    res.status(400).json({ error: 'Invalid time window' });
    return;
  }
  const questionsJson = req.body.questions ? JSON.stringify(req.body.questions) : cur.questions_json;

  db.prepare(
    `UPDATE exams SET title = ?, starts_at_utc = ?, ends_at_utc = ?, questions_json = ?
     WHERE id = ?`
  ).run(title, startsAtUtc, endsAtUtc, questionsJson, examId);

  auditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'update_exam',
    resourceType: 'exam',
    resourceId: String(examId),
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  res.json({ ok: true, id: examId });
});

// Soft-archives an exam (hidden from new student access; instructor owner or admin).
examsRouter.delete('/:examId', requireAuth, requireRole('instructor', 'admin'), (req, res) => {
  const examId = Number(req.params.examId);
  if (!Number.isFinite(examId) || examId <= 0) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }
  const access = assertExamManageAccess(req, examId);
  if (access.error === 'not_found') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (access.error === 'forbidden') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  db.prepare('UPDATE exams SET archived = 1 WHERE id = ?').run(examId);

  auditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'archive_exam',
    resourceType: 'exam',
    resourceId: String(examId),
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  res.json({ ok: true });
});

// Returns a single exam (with questions, no answer key) after assignment + window checks.
examsRouter.get('/:id', requireAuth, requireRole('student'), (req, res) => {
  const examId = Number(req.params.id);
  if (!Number.isFinite(examId)) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const assignment = db.prepare('SELECT 1 FROM exam_assignments WHERE exam_id = ? AND student_user_id = ?').get(examId, req.user.id);
  if (!assignment) {
    auditLog({
      actorUserId: req.user.id,
      actorRole: req.user.role,
      action: 'get_exam',
      resourceType: 'exam',
      resourceId: String(examId),
      outcome: 'deny',
      ip: req.ip,
      userAgent: req.get('user-agent'),
      details: { reason: 'not_assigned' }
    });
    res.status(403).json({ error: 'You are not assigned to this exam.' });
    return;
  }

  const exam = db
    .prepare(
      'SELECT id, title, starts_at_utc, ends_at_utc, questions_json, COALESCE(archived,0) AS archived FROM exams WHERE id = ?'
    )
    .get(examId);
  if (!exam) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (exam.archived) {
    res.status(403).json({ error: 'This exam has been archived and is no longer available.' });
    return;
  }
  if (!withinWindow(exam)) {
    auditLog({
      actorUserId: req.user.id,
      actorRole: req.user.role,
      action: 'get_exam',
      resourceType: 'exam',
      resourceId: String(examId),
      outcome: 'deny',
      ip: req.ip,
      userAgent: req.get('user-agent'),
      details: { reason: 'outside_time_window' }
    });
    const phase = examPhase(exam);
    const msg =
      phase === 'upcoming'
        ? 'This exam is not open yet. Questions are available only during the scheduled window.'
        : 'This exam window has ended. Questions are no longer available.';
    res.status(403).json({ error: msg });
    return;
  }

  auditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'get_exam',
    resourceType: 'exam',
    resourceId: String(examId),
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  const questions = questionsForStudent(exam.questions_json);
  res.json({
    exam: {
      id: exam.id,
      title: exam.title,
      starts_at_utc: exam.starts_at_utc,
      ends_at_utc: exam.ends_at_utc,
      questions
    }
  });
});

examsRouter.post('/', requireAuth, requireRole('instructor', 'admin'), validateBody(createExamSchema), (req, res) => {
  const { title, startsAtUtc, endsAtUtc, questions } = req.body;
  const qJson = JSON.stringify(questions ?? []);

  const info = db.prepare(
    `INSERT INTO exams (title, starts_at_utc, ends_at_utc, created_by_user_id, questions_json, archived)
     VALUES (?, ?, ?, ?, ?, 0)`
  ).run(title, startsAtUtc, endsAtUtc, req.user.id, qJson);

  auditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'create_exam',
    resourceType: 'exam',
    resourceId: String(info.lastInsertRowid),
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent'),
    details: { title }
  });

  res.status(201).json({ id: info.lastInsertRowid });
});

const assignSchema = z
  .object({
    examId: z.number().int().positive(),
    studentUserId: z.number().int().positive().optional(),
    studentUserIds: z.array(z.number().int().positive()).max(200).optional()
  })
  .superRefine((data, ctx) => {
    const ids = data.studentUserIds?.length ? data.studentUserIds : data.studentUserId != null ? [data.studentUserId] : [];
    if (ids.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'studentUserId or non-empty studentUserIds required', path: ['studentUserIds'] });
    }
    if (data.studentUserIds?.length && data.studentUserId != null) {
      ctx.addIssue({ code: 'custom', message: 'Use only one of studentUserId or studentUserIds', path: ['studentUserId'] });
    }
  });

examsRouter.post('/assign', requireAuth, requireRole('instructor', 'admin'), validateBody(assignSchema), (req, res) => {
  const { examId, studentUserId, studentUserIds } = req.body;
  const rawIds = studentUserIds?.length ? studentUserIds : studentUserId != null ? [studentUserId] : [];
  const uniqueIds = [...new Set(rawIds)];

  const exam = db.prepare('SELECT id, archived FROM exams WHERE id = ?').get(examId);
  if (!exam || exam.archived) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const studentStmt = db.prepare('SELECT id, role FROM users WHERE id = ?');
  for (const sid of uniqueIds) {
    const student = studentStmt.get(sid);
    if (!student || student.role !== 'student') {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
  }

  const insert = db.prepare('INSERT OR IGNORE INTO exam_assignments (exam_id, student_user_id) VALUES (?, ?)');
  const assignMany = db.transaction((eid, ids) => {
    let added = 0;
    for (const sid of ids) {
      const info = insert.run(eid, sid);
      if (info.changes > 0) added += 1;
    }
    return added;
  });

  const assignedCount = assignMany(examId, uniqueIds);

  auditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'assign_exam',
    resourceType: 'exam_assignment',
    resourceId: String(examId),
    outcome: 'allow',
    ip: req.ip,
    userAgent: req.get('user-agent'),
    details: { studentUserIds: uniqueIds, requestedCount: uniqueIds.length, assignedCount }
  });

  res.json({ ok: true, assignedCount, requestedCount: uniqueIds.length });
});
