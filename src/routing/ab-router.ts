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

/** Statistical analysis of A/B test results */
export interface ABTestAnalysis {
  variants: Array<{
    id: string;
    name: string;
    sampleSize: number;
    meanLatencyMs: number;
    meanCost: number;
    latencyCI: [number, number]; // 95% confidence interval
    costCI: [number, number];
  }>;
  comparison: {
    latencyZScore: number;
    costZScore: number;
    latencyPValue: number;
    costPValue: number;
    latencySignificant: boolean;
    costSignificant: boolean;
    latencyWinner: string | null;
    costWinner: string | null;
  } | null;
}

/** Get raw results for a variant */
function getVariantResults(variantId: string): Array<{ latency_ms: number; cost: number }> {
  const db = getDb();
  return db.prepare(`
    SELECT latency_ms, cost FROM ab_test_results WHERE variant_id = ?
  `).all(variantId) as Array<{ latency_ms: number; cost: number }>;
}

/** Compute standard deviation */
function stddev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const sqDiffs = values.map(v => (v - mean) ** 2);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
}

/** Approximate p-value from z-score using standard normal distribution */
function zToPValue(z: number): number {
  // Approximation of 2-tailed p-value
  const absZ = Math.abs(z);
  // Using Abramowitz and Stegun approximation
  const t = 1 / (1 + 0.2316419 * absZ);
  const d = 0.3989422804014327; // 1/sqrt(2*PI)
  const p = d * Math.exp(-absZ * absZ / 2) *
    (t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))));
  return 2 * p; // Two-tailed
}

/** Two-sample z-test */
function zTest(
  mean1: number, std1: number, n1: number,
  mean2: number, std2: number, n2: number,
): { zScore: number; pValue: number } {
  if (n1 < 2 || n2 < 2 || (std1 === 0 && std2 === 0)) {
    return { zScore: 0, pValue: 1 };
  }
  const se = Math.sqrt((std1 ** 2) / n1 + (std2 ** 2) / n2);
  if (se === 0) return { zScore: 0, pValue: 1 };
  const zScore = (mean1 - mean2) / se;
  return { zScore, pValue: zToPValue(zScore) };
}

export function getABTestAnalysis(testId: string): ABTestAnalysis {
  const db = getDb();
  const variantRows = db.prepare(`
    SELECT id, name FROM ab_test_variants WHERE test_id = ?
  `).all(testId) as Array<{ id: string; name: string }>;

  const analyzedVariants: ABTestAnalysis['variants'] = [];

  for (const v of variantRows) {
    const results = getVariantResults(v.id);
    const latencies = results.map(r => r.latency_ms ?? 0);
    const costs = results.map(r => r.cost ?? 0);
    const n = results.length;

    const meanLatency = n > 0 ? latencies.reduce((a, b) => a + b, 0) / n : 0;
    const meanCost = n > 0 ? costs.reduce((a, b) => a + b, 0) / n : 0;
    const stdLatency = stddev(latencies, meanLatency);
    const stdCost = stddev(costs, meanCost);

    // 95% CI: mean +/- 1.96 * std / sqrt(n)
    const marginLatency = n > 0 ? 1.96 * stdLatency / Math.sqrt(n) : 0;
    const marginCost = n > 0 ? 1.96 * stdCost / Math.sqrt(n) : 0;

    analyzedVariants.push({
      id: v.id,
      name: v.name,
      sampleSize: n,
      meanLatencyMs: Math.round(meanLatency * 100) / 100,
      meanCost: Math.round(meanCost * 1000000) / 1000000,
      latencyCI: [
        Math.round((meanLatency - marginLatency) * 100) / 100,
        Math.round((meanLatency + marginLatency) * 100) / 100,
      ],
      costCI: [
        Math.round((meanCost - marginCost) * 1000000) / 1000000,
        Math.round((meanCost + marginCost) * 1000000) / 1000000,
      ],
    });
  }

  // Comparison (only if exactly 2 variants)
  let comparison: ABTestAnalysis['comparison'] = null;
  if (analyzedVariants.length === 2) {
    const [a, b] = analyzedVariants;
    const aResults = getVariantResults(variantRows[0].id);
    const bResults = getVariantResults(variantRows[1].id);
    const aLatencies = aResults.map(r => r.latency_ms ?? 0);
    const bLatencies = bResults.map(r => r.latency_ms ?? 0);
    const aCosts = aResults.map(r => r.cost ?? 0);
    const bCosts = bResults.map(r => r.cost ?? 0);

    const latencyTest = zTest(
      a.meanLatencyMs, stddev(aLatencies, a.meanLatencyMs), a.sampleSize,
      b.meanLatencyMs, stddev(bLatencies, b.meanLatencyMs), b.sampleSize,
    );

    const costTest = zTest(
      a.meanCost, stddev(aCosts, a.meanCost), a.sampleSize,
      b.meanCost, stddev(bCosts, b.meanCost), b.sampleSize,
    );

    comparison = {
      latencyZScore: Math.round(latencyTest.zScore * 1000) / 1000,
      costZScore: Math.round(costTest.zScore * 1000) / 1000,
      latencyPValue: Math.round(latencyTest.pValue * 10000) / 10000,
      costPValue: Math.round(costTest.pValue * 10000) / 10000,
      latencySignificant: latencyTest.pValue < 0.05,
      costSignificant: costTest.pValue < 0.05,
      latencyWinner: latencyTest.pValue < 0.05 ? (a.meanLatencyMs < b.meanLatencyMs ? a.name : b.name) : null,
      costWinner: costTest.pValue < 0.05 ? (a.meanCost < b.meanCost ? a.name : b.name) : null,
    };
  }

  return { variants: analyzedVariants, comparison };
}
