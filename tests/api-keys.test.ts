import { describe, it, expect } from 'vitest';
import { getDb } from '../src/db/connection.js';
import {
  generateApiKey,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  activateApiKey,
  deleteApiKey,
  validateApiKey,
  rotateApiKey,
  parseScopes,
  validateScopes,
  hasScope,
  VALID_SCOPES,
  type ApiKey,
} from '../src/admin/api-keys.js';

describe('generateApiKey', () => {
  it('produces a key with fport_ prefix', () => {
    const { plainText, hash, prefix } = generateApiKey();

    expect(plainText).toMatch(/^fport_/);
    expect(prefix).toBe(plainText.slice(0, 12));
    expect(hash).toHaveLength(64); // SHA-256 hex digest
  });

  it('produces unique keys on each call', () => {
    const a = generateApiKey();
    const b = generateApiKey();

    expect(a.plainText).not.toBe(b.plainText);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('parseScopes', () => {
  it('splits a comma-separated string into trimmed tokens', () => {
    expect(parseScopes('proxy, admin:read , admin:write')).toEqual([
      'proxy',
      'admin:read',
      'admin:write',
    ]);
  });

  it('filters out empty segments', () => {
    expect(parseScopes(',proxy,,admin:read,')).toEqual(['proxy', 'admin:read']);
  });

  it('handles a single scope', () => {
    expect(parseScopes('*')).toEqual(['*']);
  });
});

describe('validateScopes', () => {
  it('accepts all valid scopes', () => {
    expect(validateScopes('*')).toBe(true);
    expect(validateScopes('proxy')).toBe(true);
    expect(validateScopes('admin:read,admin:write')).toBe(true);
    expect(validateScopes('proxy,admin:read')).toBe(true);
  });

  it('rejects invalid scopes', () => {
    expect(validateScopes('invalid')).toBe(false);
    expect(validateScopes('proxy,bogus')).toBe(false);
    expect(validateScopes('')).toBe(false);
  });
});

describe('hasScope', () => {
  function fakeKey(scopes: string): ApiKey {
    return {
      id: '1',
      key_hash: '',
      key_prefix: '',
      name: 'test',
      project_id: null,
      rate_limit_rpm: null,
      rate_limit_tpm: null,
      scopes,
      expires_at: null,
      is_active: 1,
      created_at: '',
      last_used_at: null,
    };
  }

  it('wildcard scope matches any scope', () => {
    const key = fakeKey('*');
    expect(hasScope(key, 'proxy')).toBe(true);
    expect(hasScope(key, 'admin:read')).toBe(true);
    expect(hasScope(key, 'admin:write')).toBe(true);
  });

  it('specific scope matches only that scope', () => {
    const key = fakeKey('proxy,admin:read');
    expect(hasScope(key, 'proxy')).toBe(true);
    expect(hasScope(key, 'admin:read')).toBe(true);
    expect(hasScope(key, 'admin:write')).toBe(false);
  });
});

describe('createApiKey', () => {
  it('stores key in database and returns plaintext key', () => {
    const { key, plainTextKey } = createApiKey({ name: 'My Key' });

    expect(plainTextKey).toMatch(/^fport_/);
    expect(key.name).toBe('My Key');
    expect(key.is_active).toBe(1);
    expect(key.scopes).toBe('*'); // default
    expect(key.key_hash).toBeDefined();
    expect(key.key_prefix).toBe(plainTextKey.slice(0, 12));
  });

  it('stores custom scopes', () => {
    const { key } = createApiKey({ name: 'Scoped Key', scopes: 'proxy,admin:read' });

    expect(key.scopes).toBe('proxy,admin:read');
  });

  it('throws on invalid scopes', () => {
    expect(() => createApiKey({ name: 'Bad', scopes: 'not_a_scope' })).toThrow(
      /Invalid scopes/,
    );
  });

  it('stores expiration date', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const { key } = createApiKey({ name: 'Expiring', expiresAt: future });

    expect(key.expires_at).toBe(future);
  });

  it('stores rate limits and project_id', () => {
    // Create a project first to satisfy the foreign key constraint
    const db = getDb();
    db.prepare("INSERT INTO projects (id, name) VALUES ('proj-1', 'Test Project')").run();

    const { key } = createApiKey({
      name: 'Full',
      projectId: 'proj-1',
      rateLimitRpm: 100,
      rateLimitTpm: 50_000,
    });

    expect(key.project_id).toBe('proj-1');
    expect(key.rate_limit_rpm).toBe(100);
    expect(key.rate_limit_tpm).toBe(50_000);
  });
});

describe('listApiKeys', () => {
  it('returns keys without key_hash field', () => {
    createApiKey({ name: 'Key A' });
    createApiKey({ name: 'Key B' });

    const keys = listApiKeys();

    expect(keys).toHaveLength(2);
    for (const k of keys) {
      expect(k).not.toHaveProperty('key_hash');
      expect(k).toHaveProperty('key_prefix');
      expect(k).toHaveProperty('name');
    }
  });
});

describe('validateApiKey', () => {
  it('returns key for valid active key', () => {
    const { plainTextKey } = createApiKey({ name: 'Active' });

    const result = validateApiKey(plainTextKey);

    expect(result).not.toBeNull();
    expect(result!.name).toBe('Active');
    expect(result!.is_active).toBe(1);
  });

  it('returns null for revoked key', () => {
    const { key, plainTextKey } = createApiKey({ name: 'Revoked' });
    revokeApiKey(key.id);

    expect(validateApiKey(plainTextKey)).toBeNull();
  });

  it('returns null for expired key', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const { plainTextKey } = createApiKey({ name: 'Expired', expiresAt: past });

    expect(validateApiKey(plainTextKey)).toBeNull();
  });

  it('returns null for invalid / unknown key', () => {
    expect(validateApiKey('fport_does_not_exist')).toBeNull();
  });

  it('updates last_used_at on successful validation', () => {
    const { key, plainTextKey } = createApiKey({ name: 'Track Usage' });

    // Before validation, last_used_at should be null
    const before = getDb()
      .prepare('SELECT last_used_at FROM api_keys WHERE id = ?')
      .get(key.id) as { last_used_at: string | null };
    expect(before.last_used_at).toBeNull();

    validateApiKey(plainTextKey);

    const after = getDb()
      .prepare('SELECT last_used_at FROM api_keys WHERE id = ?')
      .get(key.id) as { last_used_at: string | null };
    expect(after.last_used_at).not.toBeNull();
  });
});

describe('revokeApiKey and activateApiKey', () => {
  it('toggle is_active between 0 and 1', () => {
    const { key, plainTextKey } = createApiKey({ name: 'Toggle' });

    // Initially active
    expect(validateApiKey(plainTextKey)).not.toBeNull();

    // Revoke
    revokeApiKey(key.id);
    expect(validateApiKey(plainTextKey)).toBeNull();

    // Re-activate
    activateApiKey(key.id);
    expect(validateApiKey(plainTextKey)).not.toBeNull();
  });
});

describe('deleteApiKey', () => {
  it('removes key from database entirely', () => {
    const { key } = createApiKey({ name: 'Delete Me' });

    deleteApiKey(key.id);

    const keys = listApiKeys();
    expect(keys.find(k => k.id === key.id)).toBeUndefined();
  });
});

describe('rotateApiKey', () => {
  it('creates new key with same settings and revokes old', () => {
    const { key: oldKey, plainTextKey: oldPlain } = createApiKey({
      name: 'Rotate Me',
      scopes: 'proxy,admin:read',
      rateLimitRpm: 60,
    });

    const result = rotateApiKey(oldKey.id);

    expect(result).not.toBeNull();
    const { key: newKey, plainTextKey: newPlain } = result!;

    // New key is different
    expect(newPlain).not.toBe(oldPlain);
    expect(newKey.id).not.toBe(oldKey.id);

    // New key inherits settings
    expect(newKey.name).toBe('Rotate Me');
    expect(newKey.scopes).toBe('proxy,admin:read');
    expect(newKey.rate_limit_rpm).toBe(60);
    expect(newKey.is_active).toBe(1);

    // Old key is revoked
    expect(validateApiKey(oldPlain)).toBeNull();

    // New key is valid
    expect(validateApiKey(newPlain)).not.toBeNull();
  });

  it('returns null for non-existent key', () => {
    expect(rotateApiKey('non-existent-id')).toBeNull();
  });
});
