/**
 * Lightweight Prometheus-compatible metrics collector.
 * No external dependencies — uses in-memory storage and string formatting.
 */

interface CounterEntry {
  labels: Record<string, string>;
  value: number;
}

interface HistogramEntry {
  labels: Record<string, string>;
  sum: number;
  count: number;
  buckets: Map<number, number>;
}

interface GaugeEntry {
  labels: Record<string, string>;
  value: number;
}

const counters = new Map<string, CounterEntry[]>();
const histograms = new Map<string, HistogramEntry[]>();
const gauges = new Map<string, GaugeEntry[]>();

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function labelsKey(labels: Record<string, string>): string {
  return Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}="${v}"`).join(',');
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return `{${entries.map(([k, v]) => `${k}="${v}"`).join(',')}}`;
}

/** Increment a counter */
export function incCounter(name: string, labels: Record<string, string> = {}, value = 1): void {
  if (!counters.has(name)) counters.set(name, []);
  const entries = counters.get(name)!;
  const key = labelsKey(labels);
  const existing = entries.find(e => labelsKey(e.labels) === key);
  if (existing) {
    existing.value += value;
  } else {
    entries.push({ labels, value });
  }
}

/** Set a gauge value */
export function setGauge(name: string, labels: Record<string, string> = {}, value: number): void {
  if (!gauges.has(name)) gauges.set(name, []);
  const entries = gauges.get(name)!;
  const key = labelsKey(labels);
  const existing = entries.find(e => labelsKey(e.labels) === key);
  if (existing) {
    existing.value = value;
  } else {
    entries.push({ labels, value });
  }
}

/** Increment a gauge */
export function incGauge(name: string, labels: Record<string, string> = {}, value = 1): void {
  if (!gauges.has(name)) gauges.set(name, []);
  const entries = gauges.get(name)!;
  const key = labelsKey(labels);
  const existing = entries.find(e => labelsKey(e.labels) === key);
  if (existing) {
    existing.value += value;
  } else {
    entries.push({ labels, value });
  }
}

/** Decrement a gauge */
export function decGauge(name: string, labels: Record<string, string> = {}, value = 1): void {
  incGauge(name, labels, -value);
}

/** Observe a value in a histogram */
export function observeHistogram(name: string, labels: Record<string, string> = {}, value: number): void {
  if (!histograms.has(name)) histograms.set(name, []);
  const entries = histograms.get(name)!;
  const key = labelsKey(labels);
  let existing = entries.find(e => labelsKey(e.labels) === key);
  if (!existing) {
    existing = {
      labels,
      sum: 0,
      count: 0,
      buckets: new Map(DEFAULT_BUCKETS.map(b => [b, 0])),
    };
    entries.push(existing);
  }
  existing.sum += value;
  existing.count += 1;
  // Increment only the smallest bucket that the value fits into;
  // formatMetrics will compute the cumulative sums.
  for (const bucket of DEFAULT_BUCKETS) {
    if (value <= bucket) {
      existing.buckets.set(bucket, (existing.buckets.get(bucket) ?? 0) + 1);
      break;
    }
  }
}

/** Format all metrics in Prometheus text exposition format */
export function formatMetrics(): string {
  const lines: string[] = [];

  // Counters
  for (const [name, entries] of counters) {
    lines.push(`# TYPE ${name} counter`);
    for (const entry of entries) {
      lines.push(`${name}${formatLabels(entry.labels)} ${entry.value}`);
    }
  }

  // Gauges
  for (const [name, entries] of gauges) {
    lines.push(`# TYPE ${name} gauge`);
    for (const entry of entries) {
      lines.push(`${name}${formatLabels(entry.labels)} ${entry.value}`);
    }
  }

  // Histograms
  for (const [name, entries] of histograms) {
    lines.push(`# TYPE ${name} histogram`);
    for (const entry of entries) {
      const lblStr = formatLabels(entry.labels);
      const lblBase = Object.entries(entry.labels);
      let cumulative = 0;
      for (const bucket of DEFAULT_BUCKETS) {
        cumulative += entry.buckets.get(bucket) ?? 0;
        const bucketLabels = [...lblBase, ['le', String(bucket)]];
        const bucketLblStr = `{${bucketLabels.map(([k, v]) => `${k}="${v}"`).join(',')}}`;
        lines.push(`${name}_bucket${bucketLblStr} ${cumulative}`);
      }
      const infLabels = [...lblBase, ['le', '+Inf']];
      const infLblStr = `{${infLabels.map(([k, v]) => `${k}="${v}"`).join(',')}}`;
      lines.push(`${name}_bucket${infLblStr} ${entry.count}`);
      lines.push(`${name}_sum${lblStr} ${entry.sum}`);
      lines.push(`${name}_count${lblStr} ${entry.count}`);
    }
  }

  return lines.join('\n') + '\n';
}

/** Reset all metrics (for testing) */
export function resetMetrics(): void {
  counters.clear();
  histograms.clear();
  gauges.clear();
}
