import type { FastifyInstance } from 'fastify';
import type { FreeportConfig } from '../config/types.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { createAdminAuth } from './auth.js';
import * as promptManager from '../prompts/manager.js';
import { resolvePrompt } from '../prompts/resolver.js';
import { queryLogs, getLogStats } from '../logging/request-log.js';
import { getProjectSpend, resetDailyBudgets, resetMonthlyBudgets } from '../budget/tracker.js';
import { setKillSwitch } from '../budget/enforcer.js';
import { getActiveTests, getABTestResults } from '../routing/ab-router.js';
import { clearCache } from '../cache/semantic.js';
import { getDb } from '../db/connection.js';
import {
  listDbProviders, getDbProvider, createDbProvider, updateDbProvider,
  deleteDbProvider, toProviderConfig,
} from '../providers/manager.js';

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
      return promptManager.createPrompt(request.body);
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
      return promptManager.updatePrompt(request.params.id, request.body);
    },
  );

  app.delete<{ Params: { id: string } }>('/api/prompts/:id', async (request) => {
    promptManager.deletePrompt(request.params.id);
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
    return getActiveTests();
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
    return { success: true };
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
