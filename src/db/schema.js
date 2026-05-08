import { db } from './db.js';

// File purpose: Initializes the SQLite schema required by the secure prototype.
// Creates tables and constraints that enforce roles, uniqueness, ownership, and audit integrity.
export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student','instructor','admin')),
      is_active INTEGER NOT NULL DEFAULT 1,
      failed_login_attempts INTEGER NOT NULL DEFAULT 0,
      lock_until_utc TEXT NULL,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      starts_at_utc TEXT NOT NULL,
      ends_at_utc TEXT NOT NULL,
      created_by_user_id INTEGER NOT NULL,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS exam_assignments (
      exam_id INTEGER NOT NULL,
      student_user_id INTEGER NOT NULL,
      assigned_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (exam_id, student_user_id),
      FOREIGN KEY(exam_id) REFERENCES exams(id) ON DELETE CASCADE,
      FOREIGN KEY(student_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL,
      student_user_id INTEGER NOT NULL,
      submitted_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      nonce TEXT NOT NULL,
      integrity_hash TEXT NOT NULL,
      answers_json TEXT NOT NULL,
      UNIQUE(exam_id, student_user_id),
      UNIQUE(nonce),
      FOREIGN KEY(exam_id) REFERENCES exams(id) ON DELETE CASCADE,
      FOREIGN KEY(student_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL,
      student_user_id INTEGER NOT NULL,
      score INTEGER NOT NULL,
      published INTEGER NOT NULL DEFAULT 0,
      updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(exam_id, student_user_id),
      FOREIGN KEY(exam_id) REFERENCES exams(id) ON DELETE CASCADE,
      FOREIGN KEY(student_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      actor_user_id INTEGER NULL,
      actor_role TEXT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('allow','deny','error')),
      ip TEXT NULL,
      user_agent TEXT NULL,
      details_json TEXT NULL,
      prev_hash TEXT NULL,
      hash TEXT NOT NULL,
      FOREIGN KEY(actor_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS user_mfa (
      user_id INTEGER PRIMARY KEY,
      secret_b32 TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS security_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      type TEXT NOT NULL,
      details_json TEXT NULL,
      ip TEXT NULL,
      acknowledged INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS login_mfa_pending (
      user_id INTEGER PRIMARY KEY,
      code TEXT NOT NULL,
      expires_at_utc TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_reset_mfa_pending (
      user_id INTEGER PRIMARY KEY,
      code TEXT NOT NULL,
      expires_at_utc TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_reset_consumed (
      jti TEXT PRIMARY KEY,
      used_at_utc TEXT NOT NULL
    );
  `);

  migrateExamsColumns();
  migratePasswordResetTables();
}

// Adds columns and tables for existing SQLite files created before these features.
function migrateExamsColumns() {
  const cols = db.prepare('PRAGMA table_info(exams)').all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('questions_json')) {
    db.exec(`ALTER TABLE exams ADD COLUMN questions_json TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!names.has('archived')) {
    db.exec(`ALTER TABLE exams ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
  }
}

function migratePasswordResetTables() {
  const names = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  );
  if (!names.has('password_reset_mfa_pending')) {
    db.exec(`
      CREATE TABLE password_reset_mfa_pending (
        user_id INTEGER PRIMARY KEY,
        code TEXT NOT NULL,
        expires_at_utc TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
  }
  if (!names.has('password_reset_consumed')) {
    db.exec(`
      CREATE TABLE password_reset_consumed (
        jti TEXT PRIMARY KEY,
        used_at_utc TEXT NOT NULL
      );
    `);
  }
}

