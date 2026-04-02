import { getDb } from '../db/connection.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

export interface Prompt {
  id: string;
  slug: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptVersion {
  id: string;
  promptId: string;
  version: number;
  content: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  variables?: string[];
  tag: 'draft' | 'published' | 'archived';
  createdAt: string;
}

export function createPrompt(opts: {
  slug: string;
  name: string;
  description?: string;
}): Prompt {
  const db = getDb();

  const existing = db.prepare('SELECT id FROM prompts WHERE slug = ?').get(opts.slug);
  if (existing) throw new ValidationError(`Prompt with slug "${opts.slug}" already exists`);

  const result = db.prepare(`
    INSERT INTO prompts (slug, name, description) VALUES (?, ?, ?)
    RETURNING *
  `).get(opts.slug, opts.name, opts.description ?? null) as Record<string, unknown>;

  return mapPrompt(result);
}

export function getPrompt(idOrSlug: string): Prompt {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM prompts WHERE id = ? OR slug = ?'
  ).get(idOrSlug, idOrSlug) as Record<string, unknown> | undefined;

  if (!row) throw new NotFoundError(`Prompt "${idOrSlug}" not found`);
  return mapPrompt(row);
}

export function listPrompts(): Prompt[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM prompts ORDER BY updated_at DESC').all() as Array<Record<string, unknown>>;
  return rows.map(mapPrompt);
}

export function updatePrompt(id: string, opts: { name?: string; description?: string }): Prompt {
  const db = getDb();

  // Whitelist allowed columns to prevent SQL injection
  const ALLOWED_FIELDS: Record<string, boolean> = { name: true, description: true };
  const updates: string[] = [];
  const params: unknown[] = [];

  for (const [field, value] of Object.entries(opts)) {
    if (value !== undefined && ALLOWED_FIELDS[field]) {
      updates.push(`${field} = ?`);
      params.push(value);
    }
  }

  if (updates.length === 0) throw new ValidationError('No fields to update');

  updates.push("updated_at = datetime('now')");
  params.push(id);

  const row = db.prepare(
    `UPDATE prompts SET ${updates.join(', ')} WHERE id = ? RETURNING *`
  ).get(...params) as Record<string, unknown> | undefined;

  if (!row) throw new NotFoundError(`Prompt "${id}" not found`);
  return mapPrompt(row);
}

export function deletePrompt(id: string): void {
  const db = getDb();
  const result = db.prepare('DELETE FROM prompts WHERE id = ?').run(id);
  if (result.changes === 0) throw new NotFoundError(`Prompt "${id}" not found`);
}

// ---- Versions ----

export function createVersion(promptId: string, opts: {
  content: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  variables?: string[];
  tag?: 'draft' | 'published' | 'archived';
}): PromptVersion {
  const db = getDb();

  // Use a transaction to atomically get next version + insert
  const createVersionTx = db.transaction(() => {
    const last = db.prepare(
      'SELECT COALESCE(MAX(version), 0) as max_version FROM prompt_versions WHERE prompt_id = ?'
    ).get(promptId) as { max_version: number };

    const version = last.max_version + 1;

    const row = db.prepare(`
      INSERT INTO prompt_versions (prompt_id, version, content, model, temperature,
        max_tokens, system_prompt, variables, tag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      promptId,
      version,
      opts.content,
      opts.model ?? null,
      opts.temperature ?? null,
      opts.maxTokens ?? null,
      opts.systemPrompt ?? null,
      opts.variables ? JSON.stringify(opts.variables) : null,
      opts.tag ?? 'draft',
    ) as Record<string, unknown>;

    db.prepare("UPDATE prompts SET updated_at = datetime('now') WHERE id = ?").run(promptId);
    return row;
  });

  const row = createVersionTx();
  return mapVersion(row);
}

export function listVersions(promptId: string): PromptVersion[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY version DESC'
  ).all(promptId) as Array<Record<string, unknown>>;

  return rows.map(mapVersion);
}

export function getVersion(promptId: string, version: number): PromptVersion {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM prompt_versions WHERE prompt_id = ? AND version = ?'
  ).get(promptId, version) as Record<string, unknown> | undefined;

  if (!row) throw new NotFoundError(`Version ${version} not found for prompt "${promptId}"`);
  return mapVersion(row);
}

export function tagVersion(versionId: string, tag: 'draft' | 'published' | 'archived'): void {
  const db = getDb();

  // If publishing, unpublish any currently published version of the same prompt
  if (tag === 'published') {
    const version = db.prepare('SELECT prompt_id FROM prompt_versions WHERE id = ?')
      .get(versionId) as { prompt_id: string } | undefined;

    if (version) {
      db.prepare(`
        UPDATE prompt_versions SET tag = 'archived'
        WHERE prompt_id = ? AND tag = 'published' AND id != ?
      `).run(version.prompt_id, versionId);
    }
  }

  db.prepare('UPDATE prompt_versions SET tag = ? WHERE id = ?').run(tag, versionId);
}

function mapPrompt(row: Record<string, unknown>): Prompt {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    description: row.description as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapVersion(row: Record<string, unknown>): PromptVersion {
  return {
    id: row.id as string,
    promptId: row.prompt_id as string,
    version: row.version as number,
    content: row.content as string,
    model: row.model as string | undefined,
    temperature: row.temperature as number | undefined,
    maxTokens: row.max_tokens as number | undefined,
    systemPrompt: row.system_prompt as string | undefined,
    variables: row.variables ? JSON.parse(row.variables as string) : undefined,
    tag: row.tag as 'draft' | 'published' | 'archived',
    createdAt: row.created_at as string,
  };
}
