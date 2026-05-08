import { verifyAccessToken } from '../services/jwt.js';
import { db } from '../db/db.js';

// File purpose: Authenticate requests using Bearer JWT and attach user context.

// Requires a valid Bearer token and rejects inactive/deleted accounts.
export function requireAuth(req, res, next) {
  const hdr = req.headers.authorization;
  if (!hdr?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = hdr.slice('Bearer '.length).trim();
  verifyAccessToken(token)
    .then(({ userId, role }) => {
      const user = db
        .prepare('SELECT id, email, role, is_active FROM users WHERE id = ?')
        .get(userId);
      if (!user || user.is_active !== 1) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      req.user = { id: user.id, email: user.email, role: role ?? user.role };
      next();
    })
    .catch(() => {
      res.status(401).json({ error: 'Unauthorized' });
    });
}

// Enforces route-level RBAC before privileged or role-specific handlers execute.
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role || !allowedRoles.includes(role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}

