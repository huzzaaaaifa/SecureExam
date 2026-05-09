import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const security = require('eslint-plugin-security');

const recommended = security.configs.recommended;

/** @type {import('eslint').Linter.Config[]} */
export default [
  { ignores: ['**/node_modules/**', 'public/**', 'client/**'] },
  {
    ...recommended,
    files: ['src/**/*.js'],
    rules: {
      ...recommended.rules,
      // This rule is correct in theory but pathological on typical Express codebases (multi‑minute runs).
      'security/detect-object-injection': 'off',
    },
  },
];
