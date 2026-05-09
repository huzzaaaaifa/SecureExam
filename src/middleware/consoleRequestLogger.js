// File purpose: Print sanitized one-line HTTP debug output to the Node terminal (no bodies or secrets).

function sanitize(value) {
  return String(value ?? '-')
    .replace(/[\r\n\t]/g, ' ')
    .slice(0, 160);
}

function shouldLogToConsole() {
  if (process.env.CONSOLE_DEBUG === '0') return false;
  if (process.env.CONSOLE_DEBUG === '1') return true;
  return (process.env.NODE_ENV ?? 'development') === 'development';
}

// Logs method, path, status, duration, and IP after the response finishes.
export function consoleRequestLogger(req, res, next) {
  if (!shouldLogToConsole()) {
    next();
    return;
  }

  const startedAt = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const line = `[http] ${sanitize(req.method)} ${sanitize(req.originalUrl)} → ${res.statusCode} ${durationMs}ms ip=${sanitize(req.ip)}`;
    console.log(line);
  });
  next();
}
