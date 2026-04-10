import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer } from '../src/server.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { initDb, closeDb, getDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/runner.js';
import { initLogger } from '../src/logging/logger.js';
import { createApiKey } from '../src/admin/api-keys.js';
import { resetMetrics, formatMetrics } from '../src/observability/metrics.js';
import type { FastifyInstance } from 'fastify';
import type { FreeportConfig } from '../src/config/types.js';
import http from 'node:http';

initLogger('silent');

// --- Mock LLM Server ---
function createMockLLM(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }] }));
        return;
      }

      if (req.url === '/v1/chat/completions') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          const parsed = JSON.parse(body);

          // Check for streaming
          if (parsed.stream) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
            });
            const chunk = {
              choices: [{ delta: { content: 'Hello from mock!' }, index: 0 }],
              model: parsed.model || 'gpt-4o',
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }

          // Non-streaming response
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'chatcmpl-test123',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: parsed.model || 'gpt-4o',
            choices: [{
              index: 0,
              message: { role: 'assistant', content: 'Hello from mock LLM!' },
              finish_reason: 'stop',
            }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          }));
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    // Use port 0 to let the OS assign a free port (avoids EADDRINUSE between tests)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

function makeConfig(mockPort: number, overrides: Partial<FreeportConfig> = {}): FreeportConfig {
  return {
    server: { host: '127.0.0.1', port: 0 },
    providers: [{
      name: 'mock-openai',
      type: 'openai',
      apiBase: `http://127.0.0.1:${mockPort}`,
      keys: [{ key: 'sk-mock-test' }],
      models: ['gpt-4o', 'gpt-4o-mini'],
    }],
    auth: { adminApiKey: 'test-admin-key', apiKey: 'test-proxy-key' },
    ...overrides,
  };
}

let app: FastifyInstance | null = null;
let mockServer: http.Server | null = null;
let mockPort = 0;

beforeEach(async () => {
  const db = initDb(':memory:');
  runMigrations(db);
  resetMetrics();
  const mock = await createMockLLM();
  mockServer = mock.server;
  mockPort = mock.port;
});

afterEach(async () => {
  if (app) { await app.close(); app = null; }
  if (mockServer) {
    await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
    mockServer = null;
  }
  closeDb();
});

describe('E2E: Security Headers', () => {
  it('includes security headers from helmet', async () => {
    const config = makeConfig(mockPort);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
  });
});

describe('E2E: Full proxy round-trip', () => {
  it('completes a non-streaming chat completion', async () => {
    const config = makeConfig(mockPort);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer test-proxy-key' },
      payload: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Say hello' }],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.choices[0].message.content).toBe('Hello from mock LLM!');
    expect(body.model).toBe('gpt-4o');
    expect(body.usage.total_tokens).toBe(15);
  });

  it('completes a streaming chat completion', async () => {
    const config = makeConfig(mockPort);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer test-proxy-key' },
      payload: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Say hello' }],
        stream: true,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.payload).toContain('Hello from mock!');
  });
});

describe('E2E: API Key Auth with fport_ keys', () => {
  it('authenticates with a valid fport_ key', async () => {
    const config = makeConfig(mockPort);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const { plainTextKey } = createApiKey({ name: 'test-key' });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${plainTextKey}` },
      payload: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      },
    });

    expect(res.statusCode).toBe(200);
  });

  it('rejects an invalid fport_ key', async () => {
    const config = makeConfig(mockPort);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer fport_invalid_key_here' },
      payload: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects expired fport_ key', async () => {
    const config = makeConfig(mockPort);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    // Create key with expiration in the past
    const { plainTextKey } = createApiKey({
      name: 'expired-key',
      expiresAt: '2020-01-01T00:00:00Z',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${plainTextKey}` },
      payload: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('E2E: API Key Scopes', () => {
  it('proxy-only key can access /v1 endpoints', async () => {
    const config = makeConfig(mockPort);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const { plainTextKey } = createApiKey({ name: 'proxy-only', scopes: 'proxy' });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${plainTextKey}` },
      payload: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      },
    });

    expect(res.statusCode).toBe(200);
  });

  it('admin-read-only key cannot access proxy', async () => {
    const config = makeConfig(mockPort);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const { plainTextKey } = createApiKey({ name: 'admin-only', scopes: 'admin:read' });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${plainTextKey}` },
      payload: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('E2E: Rate Limiting', () => {
  it('rejects requests when rate limit exceeded', async () => {
    const config = makeConfig(mockPort, {
      rateLimit: { enabled: true, requestsPerMinute: 2 },
    });
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const opts = {
      method: 'POST' as const,
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer test-proxy-key' },
      payload: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      },
    };

    // First two should succeed
    const r1 = await app.inject(opts);
    expect(r1.statusCode).toBe(200);

    const r2 = await app.inject(opts);
    expect(r2.statusCode).toBe(200);

    // Third should be rate limited
    const r3 = await app.inject(opts);
    expect(r3.statusCode).toBe(429);
  });
});

describe('E2E: Metrics endpoint', () => {
  it('returns Prometheus format metrics', async () => {
    const config = makeConfig(mockPort);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    // Make a request to generate some metrics
    await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer test-proxy-key' },
      payload: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
      },
    });

    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.payload).toContain('freeport_requests_total');
  });
});

describe('E2E: Admin endpoints', () => {
  it('audit log records admin actions', async () => {
    const config = makeConfig(mockPort);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    // Create an API key (should create audit entry)
    await app.inject({
      method: 'POST',
      url: '/api/api-keys',
      headers: { authorization: 'Bearer test-admin-key' },
      payload: { name: 'test-key-for-audit' },
    });

    // Check audit log
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit-log',
      headers: { authorization: 'Bearer test-admin-key' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries.some((e: any) => e.action === 'create' && e.resource_type === 'api_key')).toBe(true);
  });

  it('API key rotation works end-to-end', async () => {
    const config = makeConfig(mockPort);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    // Create a key
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/api-keys',
      headers: { authorization: 'Bearer test-admin-key' },
      payload: { name: 'rotate-me' },
    });
    const { key, plainTextKey } = createRes.json();

    // Rotate it
    const rotateRes = await app.inject({
      method: 'POST',
      url: `/api/api-keys/${key.id}/rotate`,
      headers: { authorization: 'Bearer test-admin-key' },
    });
    expect(rotateRes.statusCode).toBe(200);
    const rotated = rotateRes.json();
    expect(rotated.plainTextKey).toBeTruthy();
    expect(rotated.plainTextKey).not.toBe(plainTextKey);

    // Old key should not work for proxy
    const oldKeyRes = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${plainTextKey}` },
      payload: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(oldKeyRes.statusCode).toBe(401);

    // New key should work
    const newKeyRes = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${rotated.plainTextKey}` },
      payload: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(newKeyRes.statusCode).toBe(200);
  });

  it('provider health endpoint returns data', async () => {
    const config = makeConfig(mockPort);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const res = await app.inject({
      method: 'GET',
      url: '/api/providers/health',
      headers: { authorization: 'Bearer test-admin-key' },
    });

    expect(res.statusCode).toBe(200);
    // Returns array (may be empty if no checks have run yet)
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('A/B test analysis endpoint works', async () => {
    const config = makeConfig(mockPort);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    // Create an A/B test
    const testRes = await app.inject({
      method: 'POST',
      url: '/api/ab-tests',
      headers: { authorization: 'Bearer test-admin-key' },
      payload: { name: 'test-experiment' },
    });
    const test = testRes.json();

    // Get analysis
    const analysisRes = await app.inject({
      method: 'GET',
      url: `/api/ab-tests/${test.id}/analysis`,
      headers: { authorization: 'Bearer test-admin-key' },
    });

    expect(analysisRes.statusCode).toBe(200);
    const analysis = analysisRes.json();
    expect(analysis.variants).toBeDefined();
    expect(Array.isArray(analysis.variants)).toBe(true);
  });

  it('settings endpoint persists changes', async () => {
    const config = makeConfig(mockPort);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    // Update settings
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { authorization: 'Bearer test-admin-key' },
      payload: { cache: { enabled: true } },
    });

    // Verify
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { authorization: 'Bearer test-admin-key' },
    });
    expect(res.json().cache.enabled).toBe(true);
  });
});
