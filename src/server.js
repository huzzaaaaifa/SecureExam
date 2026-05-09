import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { initSchema } from './db/schema.js';
import { authRouter } from './routes/auth.js';
import { examsRouter } from './routes/exams.js';
import { submissionsRouter } from './routes/submissions.js';
import { adminRouter } from './routes/admin.js';
import { resultsRouter } from './routes/results.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { requestLogger } from './middleware/requestLogger.js';
import { consoleRequestLogger } from './middleware/consoleRequestLogger.js';

// File purpose: SecureExam API server entrypoint with secure defaults.

initSchema();

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(currentDir, '../public');
const app = express();
app.disable('x-powered-by');

function isAsciiHostname(hostname) {
  if (!hostname || hostname.length > 253 || hostname.startsWith('.') || hostname.endsWith('.')) return false;
  const labels = hostname.split('.');
  for (const label of labels) {
    if (!label || label.length > 63 || label.startsWith('-') || label.endsWith('-')) return false;
    for (const ch of label) {
      const code = ch.charCodeAt(0);
      const isDigit = code >= 48 && code <= 57;
      const isUpper = code >= 65 && code <= 90;
      const isLower = code >= 97 && code <= 122;
      if (!isDigit && !isUpper && !isLower && ch !== '-') return false;
    }
  }
  return true;
}

function readHttpsRedirectOrigin() {
  const host = process.env.HTTPS_REDIRECT_HOST;
  if (!host) {
    throw new Error('HTTPS_REDIRECT_HOST is required when FORCE_HTTPS=1');
  }

  const parts = host.split(':');
  if (parts.length > 2) {
    throw new Error('HTTPS_REDIRECT_HOST must be a hostname with optional port');
  }
  const [hostname, port] = parts;
  if (!isAsciiHostname(hostname)) {
    throw new Error('HTTPS_REDIRECT_HOST must be a valid ASCII hostname');
  }
  if (port !== undefined) {
    if (port.length === 0 || port.length > 5) {
      throw new Error('HTTPS_REDIRECT_HOST port is invalid');
    }
    for (const ch of port) {
      const code = ch.charCodeAt(0);
      if (code < 48 || code > 57) {
        throw new Error('HTTPS_REDIRECT_HOST port is invalid');
      }
    }
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      throw new Error('HTTPS_REDIRECT_HOST port is invalid');
    }
  }
  return `https://${host}`;
}

// Local deploy: leave FORCE_HTTPS unset — the app serves HTTP only (e.g. http://localhost:3000).
// Enable only behind a reverse proxy that terminates TLS and forwards X-Forwarded-Proto.
if (process.env.FORCE_HTTPS === '1') {
  const httpsRedirectOrigin = readHttpsRedirectOrigin();
  const hops = Number(process.env.TRUST_PROXY ?? 1);
  app.set('trust proxy', Number.isFinite(hops) && hops >= 0 ? hops : 1);
  app.use((req, res, next) => {
    if (req.secure) {
      next();
      return;
    }
    res.redirect(301, httpsRedirectOrigin);
  });
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"]
      }
    }
  })
);
app.use(consoleRequestLogger);
if (process.env.ENABLE_FILE_REQUEST_LOG === '1') {
  app.use(requestLogger);
}
app.use(express.json({ limit: '64kb', strict: true, type: 'application/json' }));
app.use(express.static(publicDir));

app.get('/health', (req, res) => res.json({ ok: true }));
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(publicDir, 'styles.css')));
app.get('/app.js', (req, res) => res.sendFile(path.join(publicDir, 'app.js')));

app.use('/api/auth', authRouter);
app.use('/api/exams', examsRouter);
app.use('/api/submissions', submissionsRouter);
app.use('/api/results', resultsRouter);
app.use('/api/admin', adminRouter);

app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`SecureExam app listening on http://localhost:${config.port}`);
});

