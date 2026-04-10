import { describe, it, expect, vi } from 'vitest';
import { getDb } from '../src/db/connection.js';
import { logAudit, queryAuditLog } from '../src/admin/audit.js';

describe('Audit Logging', () => {
  describe('logAudit', () => {
    it('creates an entry that can be queried back', () => {
      logAudit('admin@test.com', 'create', 'provider', 'prov-1', { name: 'OpenAI' });

      const { entries, total } = queryAuditLog();
      expect(total).toBe(1);
      expect(entries).toHaveLength(1);
      expect(entries[0].actor).toBe('admin@test.com');
      expect(entries[0].action).toBe('create');
      expect(entries[0].resource_type).toBe('provider');
      expect(entries[0].resource_id).toBe('prov-1');
      expect(entries[0].details).toBe(JSON.stringify({ name: 'OpenAI' }));
      expect(entries[0].id).toBeDefined();
      expect(entries[0].created_at).toBeDefined();
    });

    it('allows null actor', () => {
      logAudit(null, 'delete', 'api_key', 'key-99');

      const { entries } = queryAuditLog();
      expect(entries).toHaveLength(1);
      expect(entries[0].actor).toBeNull();
      expect(entries[0].action).toBe('delete');
      expect(entries[0].resource_id).toBe('key-99');
    });

    it('stores details as JSON string when an object is provided', () => {
      const details = { reason: 'expired', rotatedBy: 'system', count: 42 };
      logAudit('system', 'rotate', 'api_key', 'key-5', details);

      const { entries } = queryAuditLog();
      expect(entries).toHaveLength(1);
      expect(entries[0].details).toBe(JSON.stringify(details));

      const parsed = JSON.parse(entries[0].details!);
      expect(parsed.reason).toBe('expired');
      expect(parsed.rotatedBy).toBe('system');
      expect(parsed.count).toBe(42);
    });

    it('stores null details when none are provided', () => {
      logAudit('admin', 'activate', 'provider', 'prov-2');

      const { entries } = queryAuditLog();
      expect(entries).toHaveLength(1);
      expect(entries[0].details).toBeNull();
    });

    it('does not throw when the database is unavailable', () => {
      // Close the real DB so getDb will fail inside logAudit
      const db = getDb();
      db.close();

      // logAudit catches errors internally and should not propagate
      expect(() => {
        logAudit('admin', 'create', 'provider', 'prov-x');
      }).not.toThrow();
    });
  });

  describe('queryAuditLog', () => {
    it('returns all entries when no filters are provided', () => {
      logAudit('user-a', 'create', 'provider', 'p1');
      logAudit('user-b', 'delete', 'api_key', 'k1');
      logAudit('user-c', 'update', 'prompt', 'pr1');

      const { entries, total } = queryAuditLog();
      expect(total).toBe(3);
      expect(entries).toHaveLength(3);
    });

    it('filters entries by action', () => {
      logAudit('admin', 'create', 'provider', 'p1');
      logAudit('admin', 'delete', 'provider', 'p2');
      logAudit('admin', 'create', 'api_key', 'k1');

      const { entries, total } = queryAuditLog({ action: 'create' });
      expect(total).toBe(2);
      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.action === 'create')).toBe(true);
    });

    it('filters entries by resourceType', () => {
      logAudit('admin', 'create', 'provider', 'p1');
      logAudit('admin', 'create', 'api_key', 'k1');
      logAudit('admin', 'delete', 'api_key', 'k2');

      const { entries, total } = queryAuditLog({ resourceType: 'api_key' });
      expect(total).toBe(2);
      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.resource_type === 'api_key')).toBe(true);
    });

    it('supports pagination with limit', () => {
      for (let i = 0; i < 5; i++) {
        logAudit('admin', 'create', 'provider', `p${i}`);
      }

      const { entries, total } = queryAuditLog({ limit: 2 });
      expect(total).toBe(5);
      expect(entries).toHaveLength(2);
    });

    it('supports pagination with limit and offset', () => {
      const db = getDb();
      // Insert with explicit timestamps so ordering is deterministic
      for (let i = 0; i < 5; i++) {
        db.prepare(`
          INSERT INTO audit_log (actor, action, resource_type, resource_id, created_at)
          VALUES (?, ?, ?, ?, datetime('2025-01-01 00:00:00', '+' || ? || ' minutes'))
        `).run('admin', 'create', 'provider', `p${i}`, i);
      }

      // DESC order: p4, p3, p2, p1, p0
      // offset=2, limit=2 should give: p2, p1
      const { entries, total } = queryAuditLog({ limit: 2, offset: 2 });
      expect(total).toBe(5);
      expect(entries).toHaveLength(2);
      expect(entries[0].resource_id).toBe('p2');
      expect(entries[1].resource_id).toBe('p1');
    });

    it('orders entries by created_at descending (most recent first)', () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO audit_log (actor, action, resource_type, resource_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('admin', 'create', 'provider', 'oldest', '2025-01-01 00:00:00');

      db.prepare(`
        INSERT INTO audit_log (actor, action, resource_type, resource_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('admin', 'update', 'provider', 'middle', '2025-06-15 12:00:00');

      db.prepare(`
        INSERT INTO audit_log (actor, action, resource_type, resource_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('admin', 'delete', 'provider', 'newest', '2025-12-31 23:59:59');

      const { entries } = queryAuditLog();
      expect(entries).toHaveLength(3);
      expect(entries[0].resource_id).toBe('newest');
      expect(entries[1].resource_id).toBe('middle');
      expect(entries[2].resource_id).toBe('oldest');
    });

    it('returns empty results when no entries match the filter', () => {
      logAudit('admin', 'create', 'provider', 'p1');

      const { entries, total } = queryAuditLog({ action: 'delete' });
      expect(total).toBe(0);
      expect(entries).toHaveLength(0);
    });
  });
});
