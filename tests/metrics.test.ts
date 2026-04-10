import { describe, it, expect, beforeEach } from 'vitest';
import {
  incCounter, setGauge, incGauge, decGauge,
  observeHistogram, formatMetrics, resetMetrics,
} from '../src/observability/metrics.js';

beforeEach(() => {
  resetMetrics();
});

describe('Counters', () => {
  it('increments a counter', () => {
    incCounter('test_counter');
    incCounter('test_counter');
    const output = formatMetrics();
    expect(output).toContain('test_counter 2');
  });

  it('increments counter with labels', () => {
    incCounter('test_requests', { method: 'GET', status: '200' });
    incCounter('test_requests', { method: 'GET', status: '200' });
    incCounter('test_requests', { method: 'POST', status: '500' });
    const output = formatMetrics();
    expect(output).toContain('test_requests{method="GET",status="200"} 2');
    expect(output).toContain('test_requests{method="POST",status="500"} 1');
  });

  it('increments counter by specific value', () => {
    incCounter('test_tokens', { type: 'input' }, 150);
    incCounter('test_tokens', { type: 'input' }, 50);
    const output = formatMetrics();
    expect(output).toContain('test_tokens{type="input"} 200');
  });

  it('outputs TYPE line for counter', () => {
    incCounter('my_counter');
    const output = formatMetrics();
    expect(output).toContain('# TYPE my_counter counter');
  });
});

describe('Gauges', () => {
  it('sets a gauge value', () => {
    setGauge('active_connections', {}, 5);
    const output = formatMetrics();
    expect(output).toContain('active_connections 5');
  });

  it('overwrites gauge value', () => {
    setGauge('active_connections', {}, 5);
    setGauge('active_connections', {}, 3);
    const output = formatMetrics();
    expect(output).toContain('active_connections 3');
    expect(output).not.toContain('active_connections 5');
  });

  it('increments and decrements gauge', () => {
    incGauge('active_requests');
    incGauge('active_requests');
    decGauge('active_requests');
    const output = formatMetrics();
    expect(output).toContain('active_requests 1');
  });

  it('outputs TYPE line for gauge', () => {
    setGauge('my_gauge', {}, 1);
    const output = formatMetrics();
    expect(output).toContain('# TYPE my_gauge gauge');
  });
});

describe('Histograms', () => {
  it('observes values and creates buckets', () => {
    observeHistogram('request_duration', {}, 0.05);
    observeHistogram('request_duration', {}, 0.5);
    observeHistogram('request_duration', {}, 2);
    const output = formatMetrics();
    expect(output).toContain('# TYPE request_duration histogram');
    expect(output).toContain('request_duration_count 3');
    expect(output).toMatch(/request_duration_sum [\d.]+/);
    expect(output).toContain('le="+Inf"} 3');
  });

  it('correctly distributes into buckets', () => {
    observeHistogram('h', {}, 0.001); // fits in 0.005 bucket
    const output = formatMetrics();
    // Cumulative: 0.005 has 1, 0.01 also has 1 (cumulative), etc.
    expect(output).toContain('le="0.005"} 1');
    expect(output).toContain('le="0.01"} 1');
  });

  it('handles histogram with labels', () => {
    observeHistogram('h', { provider: 'openai' }, 1.5);
    const output = formatMetrics();
    expect(output).toContain('provider="openai"');
    expect(output).toContain('h_count{provider="openai"} 1');
  });
});

describe('formatMetrics', () => {
  it('returns empty-ish output when no metrics', () => {
    const output = formatMetrics();
    expect(output).toBe('\n');
  });

  it('includes all metric types', () => {
    incCounter('c');
    setGauge('g', {}, 1);
    observeHistogram('h', {}, 0.5);
    const output = formatMetrics();
    expect(output).toContain('# TYPE c counter');
    expect(output).toContain('# TYPE g gauge');
    expect(output).toContain('# TYPE h histogram');
  });
});

describe('resetMetrics', () => {
  it('clears all metrics', () => {
    incCounter('c');
    setGauge('g', {}, 5);
    observeHistogram('h', {}, 1);
    resetMetrics();
    const output = formatMetrics();
    expect(output).toBe('\n');
  });
});
