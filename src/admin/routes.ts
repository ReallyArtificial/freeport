import type { FastifyInstance } from 'fastify';
import type { FreeportConfig } from '../config/types.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { createAdminAuth } from './auth.js';
import * as promptManager from '../prompts/manager.js';
import { resolvePrompt } from '../prompts/resolver.js';
import { queryLogs, getLogStats } from '../logging/request-log.js';
import { getProjectSpend, resetDailyBudgets, resetMonthlyBudgets } from '../budget/tracker.js';
import { setKillSwitch } from '../budget/enforcer.js';
import { getActiveTests, getABTestResults, getABTestAnalysis } from '../routing/ab-router.js';
import { clearCache } from '../cache/semantic.js';
import { getDb } from '../db/connection.js';
import {
  listDbProviders, getDbProvider, createDbProvider, updateDbProvider,
  deleteDbProvider, toProviderConfig,
} from '../providers/manager.js';
import {
  createApiKey, listApiKeys, revokeApiKey, activateApiKey, deleteApiKey, rotateApiKey,
} from './api-keys.js';
import { getAllProviderHealth } from '../routing/health.js';
import { logAudit, queryAuditLog } from './audit.js';
import { createBackup, listBackups, cleanOldBackups } from '../backup/manager.js';
import { rotateEncryptionKey } from '../crypto/encryption.js';

export function registerAdminRoutes(app: FastifyInstance, config: FreeportConfig, registry: ProviderRegistry) {
  const adminAuth = createAdminAuth(config);

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    return adminAuth(request, reply);
  });

  // --- Prompts ---
  app.get('/api/prompts', async () => {
    return promptManager.listPrompts();
  });

  app.post<{ Body: { slug: string; name: string; description?: string } }>(
    '/api/prompts',
    async (request) => {
      const result = promptManager.createPrompt(request.body);
      logAudit(null, 'create', 'prompt', result.id, { slug: request.body.slug });
      return result;
    },
  );

  app.get<{ Params: { id: string } }>('/api/prompts/:id', async (request) => {
    const prompt = promptManager.getPrompt(request.params.id);
    const versions = promptManager.listVersions(prompt.id);
    return { ...prompt, versions };
  });

  app.put<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
    '/api/prompts/:id',
    async (request) => {
      const result = promptManager.updatePrompt(request.params.id, request.body);
      logAudit(null, 'update', 'prompt', request.params.id);
      return result;
    },
  );

  app.delete<{ Params: { id: string } }>('/api/prompts/:id', async (request) => {
    promptManager.deletePrompt(request.params.id);
    logAudit(null, 'delete', 'prompt', request.params.id);
    return { success: true };
  });

  // Prompt versions
  app.post<{
    Params: { id: string };
    Body: {
      content: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
      variables?: string[];
      tag?: 'draft' | 'published' | 'archived';
    };
  }>('/api/prompts/:id/versions', async (request) => {
    return promptManager.createVersion(request.params.id, request.body);
  });

  app.get<{ Params: { id: string } }>('/api/prompts/:id/versions', async (request) => {
    return promptManager.listVersions(request.params.id);
  });

  app.put<{ Params: { versionId: string }; Body: { tag: 'draft' | 'published' | 'archived' } }>(
    '/api/prompts/versions/:versionId/tag',
    async (request) => {
      promptManager.tagVersion(request.params.versionId, request.body.tag);
      return { success: true };
    },
  );

  // Prompt resolution
  app.post<{
    Body: {
      slug: string;
      variables?: Record<string, string>;
      version?: number;
    };
  }>('/api/prompts/resolve', async (request) => {
    return resolvePrompt(request.body.slug, request.body.variables, request.body.version);
  });

  // --- Budgets ---
  app.get<{ Params: { projectId: string } }>('/api/budgets/:projectId', async (request) => {
    return getProjectSpend(request.params.projectId);
  });

  app.post<{
    Params: { projectId: string };
    Body: { monthlyLimit?: number; dailyLimit?: number };
  }>('/api/budgets/:projectId', async (request, reply) => {
    const { monthlyLimit, dailyLimit } = request.body;
    if (monthlyLimit !== undefined && (typeof monthlyLimit !== 'number' || monthlyLimit < 0)) {
      return reply.status(400).send({ error: 'monthlyLimit must be a non-negative number' });
    }
    if (dailyLimit !== undefined && (typeof dailyLimit !== 'number' || dailyLimit < 0)) {
      return reply.status(400).send({ error: 'dailyLimit must be a non-negative number' });
    }
    const db = getDb();
    db.prepare(`
      INSERT INTO budgets (project_id, monthly_limit, daily_limit)
      VALUES (?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        monthly_limit = excluded.monthly_limit,
        daily_limit = excluded.daily_limit,
        updated_at = datetime('now')
    `).run(request.params.projectId, monthlyLimit ?? null, dailyLimit ?? null);
    return { success: true };
  });

  app.post<{ Params: { projectId: string } }>('/api/budgets/:projectId/reset', async (request) => {
    const db = getDb();
    db.prepare(`
      UPDATE budgets SET monthly_spent = 0, daily_spent = 0, updated_at = datetime('now')
      WHERE project_id = ?
    `).run(request.params.projectId);
    return { success: true };
  });

  app.post<{ Params: { projectId: string }; Body: { killed: boolean } }>(
    '/api/budgets/:projectId/kill',
    async (request) => {
      setKillSwitch(request.params.projectId, request.body.killed);
      return { success: true };
    },
  );

  app.post('/api/budgets/reset-daily', async () => {
    resetDailyBudgets();
    return { success: true };
  });

  app.post('/api/budgets/reset-monthly', async () => {
    resetMonthlyBudgets();
    return { success: true };
  });

  // --- Logs ---
  app.get<{
    Querystring: {
      project_id?: string;
      model?: string;
      provider?: string;
      limit?: string;
      offset?: string;
      since?: string;
      until?: string;
    };
  }>('/api/logs', async (request) => {
    const limit = request.query.limit ? Math.min(Math.max(parseInt(request.query.limit) || 50, 1), 1000) : undefined;
    const offset = request.query.offset ? Math.max(parseInt(request.query.offset) || 0, 0) : undefined;
    return queryLogs({
      projectId: request.query.project_id,
      model: request.query.model,
      provider: request.query.provider,
      limit,
      offset,
      since: request.query.since,
      until: request.query.until,
    });
  });

  app.get<{ Querystring: { project_id?: string } }>('/api/logs/stats', async (request) => {
    return getLogStats(request.query.project_id);
  });

  // --- A/B Tests ---
  app.get('/api/ab-tests', async () => {
    const db = getDb();
    const tests = db.prepare('SELECT * FROM ab_tests ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
    return tests.map(test => {
      const variants = db.prepare('SELECT * FROM ab_test_variants WHERE test_id = ?').all(test.id as string);
      return { ...test, variants };
    });
  });

  app.post<{
    Body: { name: string; description?: string };
  }>('/api/ab-tests', async (request) => {
    const db = getDb();
    const row = db.prepare(`
      INSERT INTO ab_tests (name, description) VALUES (?, ?)
      RETURNING *
    `).get(request.body.name, request.body.description ?? null) as Record<string, unknown>;
    return row;
  });

  app.get<{ Params: { id: string } }>('/api/ab-tests/:id', async (request) => {
    const db = getDb();
    const test = db.prepare('SELECT * FROM ab_tests WHERE id = ?')
      .get(request.params.id) as Record<string, unknown>;
    if (!test) return { error: 'Not found' };

    const results = getABTestResults(request.params.id);
    return { ...test, results };
  });

  app.post<{
    Params: { id: string };
    Body: { name: string; promptId?: string; model?: string; weight?: number };
  }>('/api/ab-tests/:id/variants', async (request, reply) => {
    const weight = request.body.weight ?? 0.5;
    if (typeof weight !== 'number' || weight < 0 || weight > 1) {
      return reply.status(400).send({ error: 'weight must be a number between 0 and 1' });
    }
    const db = getDb();
    const row = db.prepare(`
      INSERT INTO ab_test_variants (test_id, name, prompt_id, model, weight)
      VALUES (?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      request.params.id,
      request.body.name,
      request.body.promptId ?? null,
      request.body.model ?? null,
      weight,
    ) as Record<string, unknown>;
    return row;
  });

  app.get<{ Params: { id: string } }>('/api/ab-tests/:id/analysis', async (request) => {
    return getABTestAnalysis(request.params.id);
  });

  app.put<{ Params: { id: string }; Body: { status: string } }>(
    '/api/ab-tests/:id/status',
    async (request) => {
      const db = getDb();
      db.prepare(`
        UPDATE ab_tests SET status = ?, updated_at = datetime('now') WHERE id = ?
      `).run(request.body.status, request.params.id);
      return { success: true };
    },
  );

  // --- Projects ---
  app.get('/api/projects', async () => {
    const db = getDb();
    return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  });

  app.post<{ Body: { name: string; description?: string; budgetLimit?: number } }>(
    '/api/projects',
    async (request) => {
      const db = getDb();
      const row = db.prepare(`
        INSERT INTO projects (name, description, budget_limit)
        VALUES (?, ?, ?)
        RETURNING *
      `).get(request.body.name, request.body.description ?? null, request.body.budgetLimit ?? null);
      return row;
    },
  );

  // --- Providers ---
  app.get('/api/providers', async () => {
    const providers = listDbProviders();
    // Mask API keys in response — only show prefix
    return providers.map(p => ({
      ...p,
      api_key: p.api_key.slice(0, 8) + '...' + p.api_key.slice(-4),
      api_key_set: true,
    }));
  });

  app.post<{
    Body: {
      name: string;
      type: 'openai' | 'anthropic' | 'google';
      apiBase?: string;
      apiKey: string;
      models?: string[];
      enabled?: boolean;
    };
  }>('/api/providers', async (request, reply) => {
    const { name, type, apiBase, apiKey, models, enabled } = request.body;
    if (!name || !type || !apiKey) {
      return reply.status(400).send({ error: { message: 'name, type, and apiKey are required' } });
    }
    if (!['openai', 'anthropic', 'google'].includes(type)) {
      return reply.status(400).send({ error: { message: 'type must be openai, anthropic, or google' } });
    }
    try {
      const provider = createDbProvider({ name, type, apiBase, apiKey, models, enabled });
      // Register in the live registry
      const providerConfig = toProviderConfig(provider);
      registry.register(providerConfig);
      logAudit(null, 'create', 'provider', provider.id, { name, type });
      return {
        ...provider,
        api_key: provider.api_key.slice(0, 8) + '...' + provider.api_key.slice(-4),
        api_key_set: true,
      };
    } catch (err: any) {
      if (err.message?.includes('UNIQUE constraint')) {
        return reply.status(409).send({ error: { message: `Provider "${name}" already exists` } });
      }
      throw err;
    }
  });

  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      type?: 'openai' | 'anthropic' | 'google';
      apiBase?: string | null;
      apiKey?: string;
      models?: string[];
      enabled?: boolean;
    };
  }>('/api/providers/:id', async (request, reply) => {
    const existing = getDbProvider(request.params.id);
    if (!existing) {
      return reply.status(404).send({ error: { message: 'Provider not found' } });
    }
    const updated = updateDbProvider(request.params.id, request.body);
    if (!updated) {
      return reply.status(404).send({ error: { message: 'Provider not found' } });
    }
    // Re-register in the live registry
    registry.unregister(existing.name);
    if (updated.enabled) {
      registry.register(toProviderConfig(updated));
    }
    logAudit(null, 'update', 'provider', request.params.id, { name: updated.name });
    return {
      ...updated,
      api_key: updated.api_key.slice(0, 8) + '...' + updated.api_key.slice(-4),
      api_key_set: true,
    };
  });

  app.delete<{ Params: { id: string } }>('/api/providers/:id', async (request, reply) => {
    const existing = getDbProvider(request.params.id);
    if (!existing) {
      return reply.status(404).send({ error: { message: 'Provider not found' } });
    }
    deleteDbProvider(request.params.id);
    registry.unregister(existing.name);
    logAudit(null, 'delete', 'provider', request.params.id, { name: existing.name });
    return { success: true };
  });

  app.post<{ Params: { id: string } }>('/api/providers/:id/test', async (request, reply) => {
    const provider = getDbProvider(request.params.id);
    if (!provider) {
      return reply.status(404).send({ error: { message: 'Provider not found' } });
    }

    const start = performance.now();
    try {
      if (provider.type === 'openai') {
        const base = provider.api_base || 'https://api.openai.com';
        const res = await fetch(`${base}/v1/models`, {
          headers: { 'Authorization': `Bearer ${provider.api_key}` },
        });
        const body = await res.json() as Record<string, unknown>;
        if (!res.ok) {
          const err = body as { error?: { message?: string } };
          return { success: false, error: err.error?.message ?? `HTTP ${res.status}`, latencyMs: Math.round(performance.now() - start) };
        }
        const models = (body.data as Array<{ id: string }> | undefined) ?? [];
        return { success: true, latencyMs: Math.round(performance.now() - start), models: models.slice(0, 10).map((m: any) => m.id) };

      } else if (provider.type === 'anthropic') {
        const base = provider.api_base || 'https://api.anthropic.com';
        const res = await fetch(`${base}/v1/messages`, {
          method: 'POST',
          headers: {
            'x-api-key': provider.api_key,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        });
        const body = await res.json() as Record<string, unknown>;
        if (!res.ok) {
          const err = body as { error?: { message?: string } };
          return { success: false, error: err.error?.message ?? `HTTP ${res.status}`, latencyMs: Math.round(performance.now() - start) };
        }
        return { success: true, latencyMs: Math.round(performance.now() - start), model: body.model };

      } else if (provider.type === 'google') {
        const base = provider.api_base || 'https://generativelanguage.googleapis.com';
        const res = await fetch(`${base}/v1beta/models?key=${provider.api_key}`);
        const body = await res.json() as Record<string, unknown>;
        if (!res.ok) {
          const err = body as { error?: { message?: string } };
          return { success: false, error: err.error?.message ?? `HTTP ${res.status}`, latencyMs: Math.round(performance.now() - start) };
        }
        const models = (body.models as Array<{ name: string }> | undefined) ?? [];
        return { success: true, latencyMs: Math.round(performance.now() - start), models: models.slice(0, 10).map((m: any) => m.name) };

      } else {
        return reply.status(400).send({ error: { message: `Unknown provider type: ${provider.type}` } });
      }
    } catch (err: any) {
      return { success: false, error: err.message ?? 'Connection failed', latencyMs: Math.round(performance.now() - start) };
    }
  });

  // --- Provider Health ---
  app.get('/api/providers/health', async () => {
    return getAllProviderHealth();
  });

  // --- API Keys ---
  app.get('/api/api-keys', async () => {
    return listApiKeys();
  });

  app.post<{
    Body: { name: string; projectId?: string; rateLimitRpm?: number; rateLimitTpm?: number; scopes?: string; expiresAt?: string };
  }>('/api/api-keys', async (request, reply) => {
    if (!request.body.name) {
      return reply.status(400).send({ error: { message: 'name is required' } });
    }
    try {
      const result = createApiKey(request.body);
      logAudit(null, 'create', 'api_key', result.key.id, { name: request.body.name, scopes: request.body.scopes });
      return { key: result.key, plainTextKey: result.plainTextKey };
    } catch (err: any) {
      if (err.statusCode === 400) {
        return reply.status(400).send({ error: { message: err.message } });
      }
      throw err;
    }
  });

  app.put<{ Params: { id: string } }>(
    '/api/api-keys/:id/revoke',
    async (request) => {
      revokeApiKey(request.params.id);
      logAudit(null, 'revoke', 'api_key', request.params.id);
      return { success: true };
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/api-keys/:id/activate',
    async (request) => {
      activateApiKey(request.params.id);
      logAudit(null, 'activate', 'api_key', request.params.id);
      return { success: true };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/api-keys/:id',
    async (request) => {
      deleteApiKey(request.params.id);
      logAudit(null, 'delete', 'api_key', request.params.id);
      return { success: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/api-keys/:id/rotate',
    async (request, reply) => {
      const result = rotateApiKey(request.params.id);
      if (!result) {
        return reply.status(404).send({ error: { message: 'API key not found' } });
      }
      logAudit(null, 'rotate', 'api_key', request.params.id, { newKeyId: result.key.id });
      return { key: result.key, plainTextKey: result.plainTextKey };
    },
  );

  // --- Fallback Chains ---
  app.get('/api/fallback-chains', async () => {
    const db = getDb();
    return db.prepare('SELECT * FROM fallback_chains ORDER BY created_at DESC').all();
  });

  app.post<{
    Body: {
      name: string;
      providers: string[];
      failureThreshold?: number;
      resetTimeoutMs?: number;
    };
  }>('/api/fallback-chains', async (request, reply) => {
    const { name, providers, failureThreshold, resetTimeoutMs } = request.body;
    if (!name || !providers?.length) {
      return reply.status(400).send({ error: { message: 'name and providers are required' } });
    }
    const db = getDb();
    try {
      const row = db.prepare(`
        INSERT INTO fallback_chains (name, provider_order, failure_threshold, reset_timeout_ms)
        VALUES (?, ?, ?, ?)
        RETURNING *
      `).get(
        name,
        JSON.stringify(providers),
        failureThreshold ?? 3,
        resetTimeoutMs ?? 60000,
      ) as Record<string, unknown>;
      logAudit(null, 'create', 'fallback_chain', row.id as string, { name });
      return row;
    } catch (err: any) {
      if (err.message?.includes('UNIQUE constraint')) {
        return reply.status(409).send({ error: { message: `Chain "${name}" already exists` } });
      }
      throw err;
    }
  });

  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      providers?: string[];
      failureThreshold?: number;
      resetTimeoutMs?: number;
      enabled?: boolean;
    };
  }>('/api/fallback-chains/:id', async (request, reply) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM fallback_chains WHERE id = ?').get(request.params.id);
    if (!existing) {
      return reply.status(404).send({ error: { message: 'Fallback chain not found' } });
    }
    const sets: string[] = [];
    const vals: unknown[] = [];
    const { name, providers, failureThreshold, resetTimeoutMs, enabled } = request.body;
    if (name !== undefined) { sets.push('name = ?'); vals.push(name); }
    if (providers !== undefined) { sets.push('provider_order = ?'); vals.push(JSON.stringify(providers)); }
    if (failureThreshold !== undefined) { sets.push('failure_threshold = ?'); vals.push(failureThreshold); }
    if (resetTimeoutMs !== undefined) { sets.push('reset_timeout_ms = ?'); vals.push(resetTimeoutMs); }
    if (enabled !== undefined) { sets.push('enabled = ?'); vals.push(enabled ? 1 : 0); }
    if (sets.length === 0) return { success: true };
    sets.push("updated_at = datetime('now')");
    vals.push(request.params.id);
    db.prepare(`UPDATE fallback_chains SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    logAudit(null, 'update', 'fallback_chain', request.params.id);
    return db.prepare('SELECT * FROM fallback_chains WHERE id = ?').get(request.params.id);
  });

  app.delete<{ Params: { id: string } }>('/api/fallback-chains/:id', async (request, reply) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM fallback_chains WHERE id = ?').get(request.params.id);
    if (!existing) {
      return reply.status(404).send({ error: { message: 'Fallback chain not found' } });
    }
    db.prepare('DELETE FROM fallback_chains WHERE id = ?').run(request.params.id);
    logAudit(null, 'delete', 'fallback_chain', request.params.id);
    return { success: true };
  });

  // --- Settings ---
  app.get('/api/settings', async () => {
    return {
      cache: {
        enabled: config.cache?.enabled ?? false,
        similarityThreshold: config.cache?.similarityThreshold ?? 0.95,
        maxEntries: config.cache?.maxEntries ?? 10000,
        ttlSeconds: config.cache?.ttlSeconds ?? 3600,
      },
      rateLimit: {
        enabled: config.rateLimit?.enabled ?? false,
        requestsPerMinute: config.rateLimit?.requestsPerMinute ?? 60,
        tokensPerMinute: config.rateLimit?.tokensPerMinute ?? 100000,
      },
      guardrails: {
        enabled: config.guardrails?.enabled ?? false,
        piiDetection: config.guardrails?.piiDetection ?? false,
        contentFilter: config.guardrails?.contentFilter ?? false,
        maxTokens: config.guardrails?.maxTokens ?? 4096,
      },
    };
  });

  app.put<{
    Body: {
      cache?: { enabled?: boolean; similarityThreshold?: number; maxEntries?: number; ttlSeconds?: number };
      rateLimit?: { enabled?: boolean; requestsPerMinute?: number; tokensPerMinute?: number };
      guardrails?: { enabled?: boolean; piiDetection?: boolean; contentFilter?: boolean; maxTokens?: number };
    };
  }>('/api/settings', async (request) => {
    const db = getDb();
    const { cache, rateLimit, guardrails } = request.body;

    // Update in-memory config
    if (cache) {
      if (!config.cache) config.cache = { enabled: false };
      Object.assign(config.cache, cache);
    }
    if (rateLimit) {
      if (!config.rateLimit) config.rateLimit = { enabled: false };
      Object.assign(config.rateLimit, rateLimit);
    }
    if (guardrails) {
      if (!config.guardrails) config.guardrails = { enabled: false };
      Object.assign(config.guardrails, guardrails);
    }

    // Persist to runtime_config table
    const upsert = db.prepare(`
      INSERT INTO runtime_config (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    if (cache) upsert.run('cache', JSON.stringify(config.cache));
    if (rateLimit) upsert.run('rateLimit', JSON.stringify(config.rateLimit));
    if (guardrails) upsert.run('guardrails', JSON.stringify(config.guardrails));

    logAudit(null, 'settings_change', 'settings', null, {
      changed: Object.keys(request.body).filter(k => (request.body as any)[k] !== undefined),
    });
    return { success: true };
  });

  // --- Audit Log ---
  app.get<{
    Querystring: {
      action?: string;
      resource_type?: string;
      since?: string;
      until?: string;
      limit?: string;
      offset?: string;
    };
  }>('/api/audit-log', async (request) => {
    return queryAuditLog({
      action: request.query.action,
      resourceType: request.query.resource_type,
      since: request.query.since,
      until: request.query.until,
      limit: request.query.limit ? parseInt(request.query.limit) : undefined,
      offset: request.query.offset ? parseInt(request.query.offset) : undefined,
    });
  });

  // --- Backups ---
  app.post('/api/backup', async (_request, reply) => {
    try {
      const result = await createBackup();
      cleanOldBackups();
      logAudit(null, 'create', 'backup', null, { filename: result.filename });
      return result;
    } catch (err: any) {
      return reply.status(500).send({ error: { message: err.message ?? 'Backup failed' } });
    }
  });

  app.get('/api/backups', async () => {
    return listBackups();
  });

  // --- Encryption Key Rotation ---
  app.post('/api/encryption/rotate-key', async (request, reply) => {
    try {
      const body = request.body as { newKeyHex?: string } | undefined;
      const result = rotateEncryptionKey(body?.newKeyHex);
      logAudit(null, 'rotate', 'encryption_key', null, { rotated: result.rotated, failed: result.failed });
      return result;
    } catch (err: any) {
      return reply.status(500).send({ error: { message: err.message ?? 'Key rotation failed' } });
    }
  });

  // --- System ---
  app.get('/api/system/status', async () => {
    const db = getDb();
    const logCount = db.prepare('SELECT COUNT(*) as count FROM request_logs').get() as { count: number };
    const cacheCount = db.prepare('SELECT COUNT(*) as count FROM cache_entries').get() as { count: number };

    // Combine config-based and runtime-registered providers
    const allProviders = Array.from(registry.getAllConfigs().keys());

    return {
      status: 'ok',
      version: '0.1.0',
      providers: allProviders,
      totalLogs: logCount.count,
      cacheEntries: cacheCount.count,
      needsSetup: allProviders.length === 0,
    };
  });

  app.post('/api/system/cache/clear', async () => {
    clearCache();
    return { success: true };
  });
}
