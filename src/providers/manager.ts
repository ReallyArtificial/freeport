import { getDb } from '../db/connection.js';
import type { ProviderConfig } from '../config/types.js';
import { encrypt, decrypt, isEncryptionReady } from '../crypto/encryption.js';

export interface DbProvider {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'google';
  api_base: string | null;
  api_key: string;
  models: string | null; // JSON array
  enabled: number;
  key_encrypted: number;
  created_at: string;
  updated_at: string;
}

export interface CreateProviderInput {
  name: string;
  type: 'openai' | 'anthropic' | 'google';
  apiBase?: string;
  apiKey: string;
  models?: string[];
  enabled?: boolean;
}

export interface UpdateProviderInput {
  name?: string;
  type?: 'openai' | 'anthropic' | 'google';
  apiBase?: string | null;
  apiKey?: string;
  models?: string[];
  enabled?: boolean;
}

/** Decrypt the api_key field if it's encrypted */
function decryptKey(row: DbProvider): DbProvider {
  if (row.key_encrypted && isEncryptionReady()) {
    try {
      return { ...row, api_key: decrypt(row.api_key) };
    } catch {
      // If decryption fails, return as-is (key may have been corrupted)
      return row;
    }
  }
  return row;
}

/** Encrypt the api_key if encryption is ready */
function encryptKey(apiKey: string): { key: string; encrypted: number } {
  if (isEncryptionReady()) {
    return { key: encrypt(apiKey), encrypted: 1 };
  }
  return { key: apiKey, encrypted: 0 };
}

export function listDbProviders(): DbProvider[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM providers ORDER BY created_at ASC').all() as DbProvider[];
  return rows.map(decryptKey);
}

export function getDbProvider(id: string): DbProvider | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as DbProvider | undefined;
  return row ? decryptKey(row) : undefined;
}

export function createDbProvider(input: CreateProviderInput): DbProvider {
  const db = getDb();
  const { key, encrypted } = encryptKey(input.apiKey);
  const row = db.prepare(`
    INSERT INTO providers (name, type, api_base, api_key, models, enabled, key_encrypted)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    input.name,
    input.type,
    input.apiBase ?? null,
    key,
    input.models ? JSON.stringify(input.models) : null,
    input.enabled !== false ? 1 : 0,
    encrypted,
  ) as DbProvider;
  return decryptKey(row);
}

export function updateDbProvider(id: string, input: UpdateProviderInput): DbProvider | undefined {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as DbProvider | undefined;
  if (!existing) return undefined;

  // Decrypt existing key for fallback
  const decrypted = decryptKey(existing);

  // If a new apiKey is provided, encrypt it
  let apiKeyToStore = existing.api_key;
  let keyEncrypted = existing.key_encrypted;
  if (input.apiKey) {
    const result = encryptKey(input.apiKey);
    apiKeyToStore = result.key;
    keyEncrypted = result.encrypted;
  }

  const row = db.prepare(`
    UPDATE providers SET
      name = ?,
      type = ?,
      api_base = ?,
      api_key = ?,
      models = ?,
      enabled = ?,
      key_encrypted = ?,
      updated_at = datetime('now')
    WHERE id = ?
    RETURNING *
  `).get(
    input.name ?? decrypted.name,
    input.type ?? decrypted.type,
    input.apiBase !== undefined ? input.apiBase : decrypted.api_base,
    apiKeyToStore,
    input.models ? JSON.stringify(input.models) : existing.models,
    input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled,
    keyEncrypted,
    id,
  ) as DbProvider;
  return decryptKey(row);
}

export function deleteDbProvider(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM providers WHERE id = ?').run(id);
  return result.changes > 0;
}

/** Convert a DB provider row to a ProviderConfig for the registry */
export function toProviderConfig(row: DbProvider): ProviderConfig {
  return {
    name: row.name,
    type: row.type,
    apiBase: row.api_base ?? undefined,
    keys: [{ key: row.api_key, weight: 1 }],
    models: row.models ? JSON.parse(row.models) : undefined,
    enabled: row.enabled === 1,
  };
}

/** Load all enabled DB providers as ProviderConfig[] */
export function loadDbProviderConfigs(): ProviderConfig[] {
  return listDbProviders()
    .filter(p => p.enabled === 1)
    .map(toProviderConfig);
}

/** Encrypt any unencrypted provider keys (run on startup after migrations) */
export function encryptExistingKeys(): void {
  if (!isEncryptionReady()) return;

  const db = getDb();
  const unencrypted = db.prepare('SELECT * FROM providers WHERE key_encrypted = 0').all() as DbProvider[];

  for (const row of unencrypted) {
    const { key, encrypted } = encryptKey(row.api_key);
    db.prepare('UPDATE providers SET api_key = ?, key_encrypted = ? WHERE id = ?')
      .run(key, encrypted, row.id);
  }

  if (unencrypted.length > 0) {
    console.log(`Encrypted ${unencrypted.length} provider key(s)`);
  }
}
