import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initLogger } from '../src/logging/logger.js';

initLogger('silent');

import {
  runHealthChecks,
  getProviderHealth,
  getAllProviderHealth,
  isProviderHealthy,
  startHealthChecks,
  stopHealthChecks,
} from '../src/routing/health.js';

describe('Health Checks', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    stopHealthChecks();
  });

  it('marks provider as healthy on successful response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    await runHealthChecks([
      { name: 'test-openai', type: 'openai', apiKey: 'sk-test' },
    ]);

    const health = getProviderHealth('test-openai');
    expect(health).toBeDefined();
    expect(health!.status).toBe('healthy');
    expect(health!.provider).toBe('test-openai');
    expect(health!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(health!.lastCheck).toBeTruthy();
    expect(health!.error).toBeUndefined();
  });

  it('marks provider as unhealthy on failed response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    await runHealthChecks([
      { name: 'test-failing', type: 'openai', apiKey: 'sk-test' },
    ]);

    const health = getProviderHealth('test-failing');
    expect(health).toBeDefined();
    expect(health!.status).toBe('unhealthy');
    expect(health!.error).toBe('HTTP 500');
  });

  it('marks provider as unhealthy on network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await runHealthChecks([
      { name: 'test-network-error', type: 'openai', apiKey: 'sk-test' },
    ]);

    const health = getProviderHealth('test-network-error');
    expect(health).toBeDefined();
    expect(health!.status).toBe('unhealthy');
    expect(health!.error).toBe('ECONNREFUSED');
  });

  it('handles OpenAI provider type with correct URL and headers', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await runHealthChecks([
      { name: 'openai-check', type: 'openai', apiBase: 'https://custom-openai.example.com', apiKey: 'sk-openai-key' },
    ]);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://custom-openai.example.com/v1/models',
      expect.objectContaining({
        headers: { 'Authorization': 'Bearer sk-openai-key' },
      }),
    );
  });

  it('handles Anthropic provider type with correct URL and headers', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await runHealthChecks([
      { name: 'anthropic-check', type: 'anthropic', apiBase: 'https://custom-anthropic.example.com', apiKey: 'ant-key' },
    ]);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://custom-anthropic.example.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'ant-key',
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        }),
        body: expect.any(String),
      }),
    );
  });

  it('handles Google provider type with correct URL and headers', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await runHealthChecks([
      { name: 'google-check', type: 'google', apiBase: 'https://custom-google.example.com', apiKey: 'goog-key' },
    ]);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://custom-google.example.com/v1beta/models?key=goog-key',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('isProviderHealthy returns true for unknown provider', () => {
    // A provider with no health check run yet should be assumed healthy
    expect(isProviderHealthy('never-checked-provider')).toBe(true);
  });

  it('isProviderHealthy returns false for unhealthy provider', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    await runHealthChecks([
      { name: 'sick-provider', type: 'openai', apiKey: 'sk-test' },
    ]);

    expect(isProviderHealthy('sick-provider')).toBe(false);
  });

  it('getAllProviderHealth returns all statuses', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 401 });

    await runHealthChecks([
      { name: 'provider-a', type: 'openai', apiKey: 'sk-a' },
      { name: 'provider-b', type: 'anthropic', apiKey: 'ant-b' },
    ]);

    const all = getAllProviderHealth();
    const names = all.map((h) => h.provider);
    expect(names).toContain('provider-a');
    expect(names).toContain('provider-b');

    const a = all.find((h) => h.provider === 'provider-a');
    const b = all.find((h) => h.provider === 'provider-b');
    expect(a!.status).toBe('healthy');
    expect(b!.status).toBe('unhealthy');
  });

  it('startHealthChecks runs immediately and stopHealthChecks clears interval', async () => {
    vi.useFakeTimers();

    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const providers = [
      { name: 'interval-provider', type: 'openai' as const, apiKey: 'sk-test' },
    ];

    startHealthChecks(providers, 30000);

    // The initial call is made immediately (but is async)
    // Advance timers to trigger one interval cycle
    await vi.advanceTimersByTimeAsync(30000);

    // fetch called at least twice: once immediately, once after the interval
    expect(vi.mocked(global.fetch).mock.calls.length).toBeGreaterThanOrEqual(2);

    stopHealthChecks();

    const callCountAfterStop = vi.mocked(global.fetch).mock.calls.length;

    // Advance another interval -- no new calls should happen
    await vi.advanceTimersByTimeAsync(30000);
    expect(vi.mocked(global.fetch).mock.calls.length).toBe(callCountAfterStop);

    vi.useRealTimers();
  });
});
