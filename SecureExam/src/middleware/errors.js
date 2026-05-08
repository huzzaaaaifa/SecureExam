// File purpose: Centralized error handling with non-sensitive responses.

// Handles unmatched routes without exposing implementation details.
export function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// Converts thrown errors into safe client responses and logs only server-side details.
export function errorHandler(err, req, res, next) {
  const status = Number(err?.statusCode ?? 500);
  const safeMessage = status >= 500 ? 'Internal server error' : (err?.message ?? 'Bad request');
  if (status >= 500) {
    // Avoid leaking stack traces to clients; rely on logs/audit.
    // eslint-disable-next-line no-console
    console.error(err);
  }
  res.status(status).json({ error: safeMessage });
}

