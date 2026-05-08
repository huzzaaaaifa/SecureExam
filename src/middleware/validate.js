import { ZodError } from 'zod';

// File purpose: Enforce strict server-side input validation.

// Parses a request body with a schema and rejects malformed input before business logic runs.
export function validateBody(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (e) {
      if (e instanceof ZodError) {
        res.status(400).json({ error: 'Invalid request', issues: e.issues.map(i => ({ path: i.path, message: i.message })) });
        return;
      }
      next(e);
    }
  };
}

