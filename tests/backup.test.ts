import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createBackup, listBackups, cleanOldBackups } from '../src/backup/manager.js';
import { initDb, closeDb, getDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/runner.js';
import { initLogger } from '../src/logging/logger.js';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';

initLogger('silent');

const TEST_BACKUP_DIR = resolve(process.cwd(), 'data', 'test-backups');

beforeEach(() => {
  const db = initDb(':memory:');
  runMigrations(db);
  // Clean up test backup dir
  if (existsSync(TEST_BACKUP_DIR)) {
    rmSync(TEST_BACKUP_DIR, { recursive: true });
  }
});

afterEach(() => {
  closeDb();
  if (existsSync(TEST_BACKUP_DIR)) {
    rmSync(TEST_BACKUP_DIR, { recursive: true });
  }
});

describe('Backup Manager', () => {
  it('creates a backup file', async () => {
    const result = await createBackup(TEST_BACKUP_DIR);

    expect(result.filename).toMatch(/^freeport-backup-.*\.db$/);
    expect(result.size).toBeGreaterThan(0);

    const backupPath = resolve(TEST_BACKUP_DIR, result.filename);
    expect(existsSync(backupPath)).toBe(true);
  });

  it('backup contains the same data as source', async () => {
    // Insert some data
    const db = getDb();
    db.prepare(`
      INSERT INTO projects (name, description) VALUES (?, ?)
    `).run('test-project', 'A test project');

    const result = await createBackup(TEST_BACKUP_DIR);
    const backupPath = resolve(TEST_BACKUP_DIR, result.filename);

    // Open the backup and verify data
    const backupDb = new Database(backupPath);
    const project = backupDb.prepare('SELECT * FROM projects WHERE name = ?').get('test-project') as any;
    expect(project).toBeTruthy();
    expect(project.description).toBe('A test project');
    backupDb.close();
  });

  it('listBackups returns sorted list', async () => {
    await createBackup(TEST_BACKUP_DIR);
    // Small delay so timestamps differ
    await new Promise(r => setTimeout(r, 10));
    await createBackup(TEST_BACKUP_DIR);

    const list = listBackups(TEST_BACKUP_DIR);
    expect(list.length).toBe(2);
    // Newest first
    expect(list[0] > list[1]).toBe(true);
  });

  it('listBackups returns empty for non-existent dir', () => {
    const list = listBackups('/tmp/nonexistent-backup-dir-xyz');
    expect(list).toEqual([]);
  });

  it('cleanOldBackups removes excess backups', async () => {
    // Create 4 backups
    for (let i = 0; i < 4; i++) {
      await createBackup(TEST_BACKUP_DIR);
      await new Promise(r => setTimeout(r, 10));
    }

    expect(listBackups(TEST_BACKUP_DIR).length).toBe(4);

    const deleted = cleanOldBackups(TEST_BACKUP_DIR, 2);
    expect(deleted).toBe(2);
    expect(listBackups(TEST_BACKUP_DIR).length).toBe(2);
  });

  it('cleanOldBackups does nothing when under threshold', async () => {
    await createBackup(TEST_BACKUP_DIR);

    const deleted = cleanOldBackups(TEST_BACKUP_DIR, 10);
    expect(deleted).toBe(0);
    expect(listBackups(TEST_BACKUP_DIR).length).toBe(1);
  });
});
