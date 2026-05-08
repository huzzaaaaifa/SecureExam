import { db } from '../db/db.js';
import { sha256Hex } from './crypto.js';

// File purpose: Provide tamper-evident (hash-chained) audit logging for security events.

// Fetches the latest audit hash so a new record can link to the previous record.
function getLastHash() {
  const row = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get();
  return row?.hash ?? null;
}

// Writes a security event with actor, outcome, metadata, previous hash, and current hash.
export function auditLog({
  actorUserId,
  actorRole,
  action,
  resourceType,
  resourceId,
  outcome,
  ip,
  userAgent,
  details
}) {
  const prevHash = getLastHash();
  const payload = JSON.stringify({
    ts: new Date().toISOString(),
    actorUserId: actorUserId ?? null,
    actorRole: actorRole ?? null,
    action,
    resourceType,
    resourceId: resourceId ?? null,
    outcome,
    ip: ip ?? null,
    userAgent: userAgent ?? null,
    details: details ?? null,
    prevHash
  });

  const hash = sha256Hex(payload);
  db.prepare(
    `INSERT INTO audit_log
      (actor_user_id, actor_role, action, resource_type, resource_id, outcome, ip, user_agent, details_json, prev_hash, hash)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    actorUserId ?? null,
    actorRole ?? null,
    action,
    resourceType,
    resourceId ?? null,
    outcome,
    ip ?? null,
    userAgent ?? null,
    details ? JSON.stringify(details) : null,
    prevHash,
    hash
  );
}

