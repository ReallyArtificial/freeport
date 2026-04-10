import { getDb } from '../db/connection.js';
import { mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_BACKUP_DIR = resolve(process.cwd(), 'data', 'backups');

/** Create a hot backup of the current database using better-sqlite3's .backup() */
export async function createBackup(destDir: string = DEFAULT_BACKUP_DIR): Promise<{ filename: string; size: number }> {
  const db = getDb();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `freeport-backup-${ts}.db`;
  const destPath = resolve(destDir, filename);
  mkdirSync(destDir, { recursive: true });
  await db.backup(destPath);
  const size = statSync(destPath).size;
  return { filename, size };
}

/** List all backup files in the directory, sorted newest first */
export function listBackups(destDir: string = DEFAULT_BACKUP_DIR): string[] {
  try {
    const files = readdirSync(destDir)
      .filter(f => f.startsWith('freeport-backup-') && f.endsWith('.db'))
      .sort()
      .reverse();
    return files;
  } catch {
    return [];
  }
}

/** Delete oldest backups beyond the keep count */
export function cleanOldBackups(destDir: string = DEFAULT_BACKUP_DIR, keepCount: number = 10): number {
  const files = listBackups(destDir);
  let deleted = 0;
  if (files.length > keepCount) {
    const toDelete = files.slice(keepCount);
    for (const file of toDelete) {
      unlinkSync(resolve(destDir, file));
      deleted++;
    }
  }
  return deleted;
}
