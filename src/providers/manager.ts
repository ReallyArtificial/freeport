import { getDb } from '../db/connection.js';
import type { ProviderConfig } from '../config/types.js';

export interface DbProvider {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'google';
  api_base: string | null;
  api_key: string;
  models: string | null; // JSON array
  enabled: number;
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

export function listDbProviders(): DbProvider[] {
  const db = getDb();
  return db.prepare('SELECT * FROM providers ORDER BY created_at ASC').all() as DbProvider[];
}

export function getDbProvider(id: string): DbProvider | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as DbProvider | undefined;
}

export function createDbProvider(input: CreateProviderInput): DbProvider {
  const db = getDb();
  const row = db.prepare(`
    INSERT INTO providers (name, type, api_base, api_key, models, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    input.name,
    input.type,
    input.apiBase ?? null,
    input.apiKey,
    input.models ? JSON.stringify(input.models) : null,
    input.enabled !== false ? 1 : 0,
  ) as DbProvider;
  return row;
}

export function updateDbProvider(id: string, input: UpdateProviderInput): DbProvider | undefined {
  const db = getDb();
  const existing = getDbProvider(id);
  if (!existing) return undefined;

  const row = db.prepare(`
    UPDATE providers SET
      name = ?,
      type = ?,
      api_base = ?,
      api_key = ?,
      models = ?,
      enabled = ?,
      updated_at = datetime('now')
    WHERE id = ?
    RETURNING *
  `).get(
    input.name ?? existing.name,
    input.type ?? existing.type,
    input.apiBase !== undefined ? input.apiBase : existing.api_base,
    input.apiKey ?? existing.api_key,
    input.models ? JSON.stringify(input.models) : existing.models,
    input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled,
    id,
  ) as DbProvider;
  return row;
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
