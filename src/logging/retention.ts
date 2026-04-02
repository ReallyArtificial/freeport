import { getDb } from '../db/connection.js';
import { getLogger } from './logger.js';

/**
 * Clean up old log entries based on retention policy.
 * Default: keep 30 days of logs.
 */
export function cleanupOldLogs(retentionDays: number = 30): number {
  const log = getLogger();
  const db = getDb();

  const result = db.prepare(`
    DELETE FROM request_logs
    WHERE created_at < datetime('now', ? || ' days')
  `).run(`-${retentionDays}`);

  if (result.changes > 0) {
    log.info({ deleted: result.changes, retentionDays }, 'Cleaned up old request logs');
  }

  return result.changes;
}

/** Start periodic cleanup (runs daily) */
export function startRetentionCleanup(retentionDays: number = 30): void {
  // Run immediately on startup
  cleanupOldLogs(retentionDays);

  // Then run daily
  const interval = setInterval(() => {
    cleanupOldLogs(retentionDays);
  }, 24 * 60 * 60 * 1000);

  interval.unref();
}
