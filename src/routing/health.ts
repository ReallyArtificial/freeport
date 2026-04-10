import { getLogger } from '../logging/logger.js';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ProviderHealth {
  provider: string;
  status: HealthStatus;
  latencyMs: number;
  lastCheck: string;
  error?: string;
}

interface ProviderCheckConfig {
  name: string;
  type: 'openai' | 'anthropic' | 'google';
  apiBase?: string;
  apiKey: string;
}

const healthMap = new Map<string, ProviderHealth>();
let checkInterval: ReturnType<typeof setInterval> | null = null;

/** Threshold for degraded status (ms) */
const DEGRADED_THRESHOLD = 5000;

/** Ping a single provider and return health status */
async function checkProvider(config: ProviderCheckConfig): Promise<ProviderHealth> {
  const start = performance.now();
  try {
    let res: Response;

    if (config.type === 'openai') {
      const base = config.apiBase || 'https://api.openai.com';
      res = await fetch(`${base}/v1/models`, {
        headers: { 'Authorization': `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
    } else if (config.type === 'anthropic') {
      const base = config.apiBase || 'https://api.anthropic.com';
      res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(10000),
      });
    } else {
      const base = config.apiBase || 'https://generativelanguage.googleapis.com';
      res = await fetch(`${base}/v1beta/models?key=${config.apiKey}`, {
        signal: AbortSignal.timeout(10000),
      });
    }

    const latencyMs = Math.round(performance.now() - start);

    if (!res.ok) {
      return {
        provider: config.name,
        status: 'unhealthy',
        latencyMs,
        lastCheck: new Date().toISOString(),
        error: `HTTP ${res.status}`,
      };
    }

    const status: HealthStatus = latencyMs > DEGRADED_THRESHOLD ? 'degraded' : 'healthy';
    return {
      provider: config.name,
      status,
      latencyMs,
      lastCheck: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      provider: config.name,
      status: 'unhealthy',
      latencyMs: Math.round(performance.now() - start),
      lastCheck: new Date().toISOString(),
      error: err.message ?? 'Connection failed',
    };
  }
}

/** Run health checks for all configured providers */
export async function runHealthChecks(providers: ProviderCheckConfig[]): Promise<void> {
  const log = getLogger();

  for (const provider of providers) {
    try {
      const health = await checkProvider(provider);
      healthMap.set(provider.name, health);

      if (health.status !== 'healthy') {
        log.warn({ provider: provider.name, status: health.status, error: health.error }, 'Provider health check failed');
      }
    } catch (err) {
      log.error({ provider: provider.name, err }, 'Health check error');
    }
  }
}

/** Start periodic health checks */
export function startHealthChecks(providers: ProviderCheckConfig[], intervalMs = 60000): void {
  // Run immediately
  runHealthChecks(providers);

  // Then periodically
  checkInterval = setInterval(() => runHealthChecks(providers), intervalMs);
}

/** Stop health checks */
export function stopHealthChecks(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

/** Get health status for a specific provider */
export function getProviderHealth(name: string): ProviderHealth | undefined {
  return healthMap.get(name);
}

/** Get all provider health statuses */
export function getAllProviderHealth(): ProviderHealth[] {
  return Array.from(healthMap.values());
}

/** Check if a provider is healthy (for load balancer) */
export function isProviderHealthy(name: string): boolean {
  const health = healthMap.get(name);
  if (!health) return true; // Unknown = assume healthy (no check run yet)
  return health.status !== 'unhealthy';
}
