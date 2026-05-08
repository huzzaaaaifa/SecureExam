import Database from 'better-sqlite3';
import fs from 'node:fs';
import { config } from '../config.js';

// Ensures the fixed local data directory exists before SQLite opens the file.
function ensureDataDirectory() {
  fs.mkdirSync('data', { recursive: true });
}

ensureDataDirectory();

export const db = new Database(config.sqlitePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

