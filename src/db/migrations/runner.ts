import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATIONS = [
  { version: 1, file: '001_initial.sql' },
  { version: 2, file: '002_prompts.sql' },
  { version: 3, file: '003_cache.sql' },
  { version: 4, file: '004_ab_tests.sql' },
];

export function runMigrations(db: Database.Database): void {
  // Ensure schema_version table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const currentVersion = db.prepare(
    'SELECT COALESCE(MAX(version), 0) as version FROM schema_version'
  ).get() as { version: number };

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion.version) continue;

    const sql = readFileSync(resolve(__dirname, migration.file), 'utf-8');

    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version);
    })();

    console.log(`Applied migration ${migration.file}`);
  }
}
