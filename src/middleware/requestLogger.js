import fs from 'node:fs';

// File purpose: Log sanitized HTTP request metadata without recording credentials or bodies.

const LOG_FILE_PATH = 'logs/app.log';

// Creates the fixed local logs directory used by the request logger.
function ensureLogDirectory() {
  fs.mkdirSync('logs', { recursive: true });
}

// Removes control characters and limits path length before writing to logs.
function sanitizeLogText(value) {
  return String(value ?? '-')
    .replace(/[\r\n\t]/g, ' ')
    .slice(0, 180);
}

// Records method, path, status, duration, and client metadata for operational monitoring.
export function requestLogger(req, res, next) {
  const startedAt = Date.now();

  res.on('finish', () => {
    ensureLogDirectory();
    const durationMs = Date.now() - startedAt;
    const logRecord = {
      timestampUtc: new Date().toISOString(),
      method: sanitizeLogText(req.method),
      path: sanitizeLogText(req.originalUrl),
      statusCode: res.statusCode,
      durationMs,
      ip: sanitizeLogText(req.ip),
      userAgent: sanitizeLogText(req.get('user-agent'))
    };
    const line = `${JSON.stringify(logRecord)}\n`;
    fs.appendFile(LOG_FILE_PATH, line, (error) => {
      if (error) {
        console.error('Failed to write request log', error.message);
      }
    });
  });

  next();
}

