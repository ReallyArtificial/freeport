import { getDb } from '../db/connection.js';

export interface AuditEntry {
  id: string;
  actor: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: string | null;
  created_at: string;
}

export type AuditAction =
  | 'create' | 'update' | 'delete' | 'revoke' | 'activate' | 'rotate' | 'settings_change';

export type AuditResourceType =
  | 'provider' | 'api_key' | 'prompt' | 'fallback_chain' | 'ab_test' | 'budget' | 'settings'
  | 'backup' | 'encryption_key';

/** Log an audit event */
export function logAudit(
  actor: string | null,
  action: AuditAction,
  resourceType: AuditResourceType,
  resourceId?: string | null,
  details?: Record<string, unknown> | null,
): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO audit_log (actor, action, resource_type, resource_id, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      actor,
      action,
      resourceType,
      resourceId ?? null,
      details ? JSON.stringify(details) : null,
    );
  } catch {
    // Don't let audit logging break normal operations
  }
}

export interface AuditQuery {
  action?: string;
  resourceType?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

/** Query audit log with filters */
export function queryAuditLog(query: AuditQuery = {}): { entries: AuditEntry[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.action) {
    conditions.push('action = ?');
    params.push(query.action);
  }
  if (query.resourceType) {
    conditions.push('resource_type = ?');
    params.push(query.resourceType);
  }
  if (query.since) {
    conditions.push('created_at >= ?');
    params.push(query.since);
  }
  if (query.until) {
    conditions.push('created_at <= ?');
    params.push(query.until);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`SELECT COUNT(*) as count FROM audit_log ${whereClause}`).get(...params) as { count: number }).count;

  const limit = Math.min(query.limit ?? 50, 1000);
  const offset = query.offset ?? 0;

  const entries = db.prepare(
    `SELECT * FROM audit_log ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as AuditEntry[];

  return { entries, total };
}
