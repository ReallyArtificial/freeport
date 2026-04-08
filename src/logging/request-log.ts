import { getDb } from '../db/connection.js';

export interface RequestLogEntry {
  id?: string;
  projectId?: string;
  apiKeyId?: string;
  provider: string;
  model: string;
  requestBody?: string;
  responseBody?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cost?: number;
  latencyMs?: number;
  statusCode?: number;
  isCached?: boolean;
  isFallback?: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export function logRequest(entry: RequestLogEntry): string {
  const db = getDb();
  const id = entry.id ?? crypto.randomUUID().replace(/-/g, '');

  db.prepare(`
    INSERT INTO request_logs (id, project_id, api_key_id, provider, model,
      request_body, response_body, input_tokens, output_tokens, total_tokens,
      cost, latency_ms, status_code, is_cached, is_fallback, error, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    entry.projectId ?? null,
    entry.apiKeyId ?? null,
    entry.provider,
    entry.model,
    entry.requestBody ?? null,
    entry.responseBody ?? null,
    entry.inputTokens ?? 0,
    entry.outputTokens ?? 0,
    entry.totalTokens ?? 0,
    entry.cost ?? 0,
    entry.latencyMs ?? 0,
    entry.statusCode ?? 200,
    entry.isCached ? 1 : 0,
    entry.isFallback ? 1 : 0,
    entry.error ?? null,
    entry.metadata ? JSON.stringify(entry.metadata) : null,
  );

  return id;
}

export function queryLogs(opts: {
  projectId?: string;
  model?: string;
  provider?: string;
  limit?: number;
  offset?: number;
  since?: string;
  until?: string;
}): RequestLogEntry[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.projectId) { conditions.push('project_id = ?'); params.push(opts.projectId); }
  if (opts.model) { conditions.push('model = ?'); params.push(opts.model); }
  if (opts.provider) { conditions.push('provider = ?'); params.push(opts.provider); }
  if (opts.since) { conditions.push('created_at >= ?'); params.push(opts.since); }
  if (opts.until) { conditions.push('created_at <= ?'); params.push(opts.until); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const rows = db.prepare(`
    SELECT * FROM request_logs ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Array<Record<string, unknown>>;

  return rows.map(row => ({
    id: row.id as string,
    projectId: row.project_id as string | undefined,
    apiKeyId: row.api_key_id as string | undefined,
    provider: row.provider as string,
    model: row.model as string,
    requestBody: row.request_body as string | undefined,
    responseBody: row.response_body as string | undefined,
    inputTokens: row.input_tokens as number,
    outputTokens: row.output_tokens as number,
    totalTokens: row.total_tokens as number,
    cost: row.cost as number,
    latencyMs: row.latency_ms as number,
    statusCode: row.status_code as number,
    isCached: row.is_cached === 1,
    isFallback: row.is_fallback === 1,
    error: row.error as string | undefined,
    createdAt: row.created_at as string,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
  }));
}

export function getLogStats(projectId?: string): {
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  cacheHits: number;
  cacheHitRate: number;
  avgLatencyMs: number;
  modelBreakdown: Array<{ model: string; count: number; cost: number }>;
} {
  const db = getDb();
  const where = projectId ? 'WHERE project_id = ?' : '';
  const params = projectId ? [projectId] : [];

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_requests,
      COALESCE(SUM(cost), 0) as total_cost,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(is_cached), 0) as cache_hits,
      COALESCE(AVG(latency_ms), 0) as avg_latency_ms
    FROM request_logs ${where}
  `).get(...params) as Record<string, number>;

  const modelBreakdown = db.prepare(`
    SELECT model, COUNT(*) as count, COALESCE(SUM(cost), 0) as cost
    FROM request_logs ${where}
    GROUP BY model ORDER BY count DESC
  `).all(...params) as Array<{ model: string; count: number; cost: number }>;

  return {
    totalRequests: stats.total_requests,
    totalCost: stats.total_cost,
    totalTokens: stats.total_tokens,
    cacheHits: stats.cache_hits,
    cacheHitRate: stats.total_requests > 0 ? stats.cache_hits / stats.total_requests : 0,
    avgLatencyMs: Math.round(stats.avg_latency_ms),
    modelBreakdown,
  };
}
