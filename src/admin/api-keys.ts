import { randomBytes, createHash } from 'node:crypto';
import { getDb } from '../db/connection.js';

export interface ApiKey {
  id: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  project_id: string | null;
  rate_limit_rpm: number | null;
  rate_limit_tpm: number | null;
  is_active: number;
  created_at: string;
  last_used_at: string | null;
}

export interface CreateApiKeyInput {
  name: string;
  projectId?: string;
  rateLimitRpm?: number;
  rateLimitTpm?: number;
}

/** Generate a new Freeport API key with `fport_` prefix */
export function generateApiKey(): { plainText: string; hash: string; prefix: string } {
  const raw = randomBytes(32).toString('base64url');
  const plainText = `fport_${raw}`;
  const hash = createHash('sha256').update(plainText).digest('hex');
  const prefix = plainText.slice(0, 12);
  return { plainText, hash, prefix };
}

/** Create a new API key — returns the full plaintext key ONCE */
export function createApiKey(input: CreateApiKeyInput): { key: ApiKey; plainTextKey: string } {
  const { plainText, hash, prefix } = generateApiKey();
  const db = getDb();

  const row = db.prepare(`
    INSERT INTO api_keys (key_hash, key_prefix, name, project_id, rate_limit_rpm, rate_limit_tpm)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    hash,
    prefix,
    input.name,
    input.projectId ?? null,
    input.rateLimitRpm ?? null,
    input.rateLimitTpm ?? null,
  ) as ApiKey;

  return { key: row, plainTextKey: plainText };
}

/** List all API keys (never returns hashes) */
export function listApiKeys(): Omit<ApiKey, 'key_hash'>[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, key_prefix, name, project_id, rate_limit_rpm, rate_limit_tpm,
           is_active, created_at, last_used_at
    FROM api_keys ORDER BY created_at DESC
  `).all() as Omit<ApiKey, 'key_hash'>[];
  return rows;
}

/** Revoke an API key (set is_active = 0) */
export function revokeApiKey(id: string): void {
  const db = getDb();
  db.prepare('UPDATE api_keys SET is_active = 0 WHERE id = ?').run(id);
}

/** Activate an API key (set is_active = 1) */
export function activateApiKey(id: string): void {
  const db = getDb();
  db.prepare('UPDATE api_keys SET is_active = 1 WHERE id = ?').run(id);
}

/** Hard delete an API key */
export function deleteApiKey(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
}

/** Validate a plaintext API key — returns the key row if valid, null otherwise */
export function validateApiKey(plainText: string): ApiKey | null {
  const hash = createHash('sha256').update(plainText).digest('hex');
  const db = getDb();

  const row = db.prepare(`
    SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1
  `).get(hash) as ApiKey | undefined;

  if (row) {
    // Update last_used_at
    db.prepare('UPDATE api_keys SET last_used_at = datetime(\'now\') WHERE id = ?').run(row.id);
  }

  return row ?? null;
}
