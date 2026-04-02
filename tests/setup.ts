import { initDb, closeDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/runner.js';
import { initLogger } from '../src/logging/logger.js';
import { afterEach, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Unique DB path per worker to avoid parallel test file collisions
const TEST_DB_PATH = resolve(process.cwd(), 'tests', `test-${randomUUID()}.db`);

// Silence logs during tests
initLogger('silent');

beforeEach(() => {
  // Fresh DB for each test
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB_PATH + suffix;
    if (existsSync(p)) unlinkSync(p);
  }

  const db = initDb(TEST_DB_PATH);
  runMigrations(db);
});

afterEach(() => {
  try { closeDb(); } catch { /* already closed */ }
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB_PATH + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
});
