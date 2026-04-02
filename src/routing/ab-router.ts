import { getDb } from '../db/connection.js';
import { getLogger } from '../logging/logger.js';

export interface ABTestVariant {
  id: string;
  testId: string;
  name: string;
  promptId?: string;
  model?: string;
  weight: number;
  config?: Record<string, unknown>;
}

export interface ABTest {
  id: string;
  name: string;
  status: string;
  variants: ABTestVariant[];
}

export function getActiveTests(): ABTest[] {
  const db = getDb();
  const tests = db.prepare(`
    SELECT * FROM ab_tests WHERE status = 'running'
  `).all() as Array<Record<string, unknown>>;

  return tests.map(test => {
    const variants = db.prepare(`
      SELECT * FROM ab_test_variants WHERE test_id = ?
    `).all(test.id as string) as Array<Record<string, unknown>>;

    return {
      id: test.id as string,
      name: test.name as string,
      status: test.status as string,
      variants: variants.map(v => ({
        id: v.id as string,
        testId: v.test_id as string,
        name: v.name as string,
        promptId: v.prompt_id as string | undefined,
        model: v.model as string | undefined,
        weight: v.weight as number,
        config: v.config ? (() => { try { return JSON.parse(v.config as string); } catch { return undefined; } })() : undefined,
      })),
    };
  });
}

/** Select a variant based on weights using weighted random selection */
export function selectVariant(test: ABTest): ABTestVariant | null {
  if (test.variants.length === 0) return null;

  const totalWeight = test.variants.reduce((sum, v) => sum + v.weight, 0);
  let random = Math.random() * totalWeight;

  for (const variant of test.variants) {
    random -= variant.weight;
    if (random <= 0) return variant;
  }

  return test.variants[0];
}

/** Record an A/B test result */
export function recordABResult(opts: {
  testId: string;
  variantId: string;
  requestLogId?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
}): void {
  const log = getLogger();
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO ab_test_results (test_id, variant_id, request_log_id,
        latency_ms, input_tokens, output_tokens, cost)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      opts.testId,
      opts.variantId,
      opts.requestLogId ?? null,
      opts.latencyMs ?? null,
      opts.inputTokens ?? null,
      opts.outputTokens ?? null,
      opts.cost ?? null,
    );
  } catch (err) {
    log.error({ err }, 'Failed to record A/B test result');
  }
}

/** Get aggregated A/B test results */
export function getABTestResults(testId: string) {
  const db = getDb();

  const variants = db.prepare(`
    SELECT
      v.id, v.name, v.weight,
      COUNT(r.id) as total_requests,
      COALESCE(AVG(r.latency_ms), 0) as avg_latency_ms,
      COALESCE(SUM(r.cost), 0) as total_cost,
      COALESCE(AVG(r.cost), 0) as avg_cost,
      COALESCE(SUM(r.input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(r.output_tokens), 0) as total_output_tokens
    FROM ab_test_variants v
    LEFT JOIN ab_test_results r ON r.variant_id = v.id
    WHERE v.test_id = ?
    GROUP BY v.id
  `).all(testId) as Array<Record<string, unknown>>;

  return variants;
}
