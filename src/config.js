import 'dotenv/config';

const DEFAULT_NODE_ENV = 'development';
const DEFAULT_SQLITE_PATH = './data/secureexam.sqlite';
const DEFAULT_JWT_ISSUER = 'secureexam';
const DEFAULT_JWT_AUDIENCE = 'secureexam-api';

// Rejects placeholder or weak secrets so the app cannot run with demo credentials.
function readJwtSecret() {
  const secretValue = process.env.JWT_SECRET;
  if (!secretValue) throw new Error('Missing required env var: JWT_SECRET');
  if (secretValue.length < 32 || secretValue.includes('change_me') || secretValue.includes('replace_with')) {
    throw new Error('JWT_SECRET must be replaced with a long random secret');
  }
  return secretValue;
}

// Restricts SQLite to the project data folder to avoid unsafe file path configuration.
function readSqlitePath() {
  const configuredPath = process.env.SQLITE_PATH ?? DEFAULT_SQLITE_PATH;
  const normalizedPath = configuredPath.replaceAll('\\', '/');
  if (normalizedPath.includes('..') || !normalizedPath.startsWith('./data/')) {
    throw new Error('SQLITE_PATH must stay inside ./data');
  }
  return configuredPath;
}

export const config = {
  env: process.env.NODE_ENV ?? DEFAULT_NODE_ENV,
  port: Number(process.env.PORT ?? 3000),
  sqlitePath: readSqlitePath(),
  jwt: {
    secret: readJwtSecret(),
    issuer: process.env.JWT_ISSUER ?? DEFAULT_JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE ?? DEFAULT_JWT_AUDIENCE,
    accessTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 900)
  },
  security: {
    loginMaxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS ?? 5),
    lockoutMinutes: Number(process.env.LOCKOUT_MINUTES ?? 10)
  }
};

