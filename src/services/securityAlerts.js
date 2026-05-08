// File purpose: Append-only security alerts for admins (lockouts, repeated failures).

import { db } from '../db/db.js';

// Inserts a simple alert row for dashboard review (no automatic email in prototype).
export function insertSecurityAlert({ type, details, ip }) {
  try {
    db.prepare(
      `INSERT INTO security_alerts (type, details_json, ip)
       VALUES (?, ?, ?)`
    ).run(type, JSON.stringify(details ?? {}), ip ?? null);
  } catch {
    // Non-fatal if table missing during migration edge case.
  }
}
