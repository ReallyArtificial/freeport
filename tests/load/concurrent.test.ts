import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../../src/server.js';
import { ProviderRegistry } from '../../src/providers/registry.js';
import { initDb, closeDb } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations/runner.js';
import { initLogger } from '../../src/logging/logger.js';
import { resetMetrics } from '../../src/observability/metrics.js';
import type { FastifyInstance } from 'fastify';
import type { FreeportConfig } from '../../src/config/types.js';
import http from 'node:http';

initLogger('silent');

function createMockLLM(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/v1/chat/completions') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          const parsed = JSON.parse(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'chatcmpl-load-test',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: parsed.model || 'gpt-4o',
            choices: [{
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
          }));
        });
        return;
      }
      res.writeHead(404);
      res.end('Not found');
    });

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
      models: ['gpt-4o'],
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

const makeRequest = (appInstance: FastifyInstance) => appInstance.inject({
  method: 'POST',
  url: '/v1/chat/completions',
  headers: { authorization: 'Bearer test-proxy-key' },
  payload: {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hello' }],
  },
});

describe('Load Tests', () => {
  it('handles 50 concurrent requests', async () => {
    const config = makeConfig(mockPort);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const promises = Array.from({ length: 50 }, () => makeRequest(app!));
    const results = await Promise.all(promises);

    for (const res of results) {
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.choices[0].message.content).toBe('ok');
    }
  });

  it('rate limiting works under concurrent load', async () => {
    const config = makeConfig(mockPort, {
      rateLimit: { enabled: true, requestsPerMinute: 5 },
    });
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const promises = Array.from({ length: 10 }, () => makeRequest(app!));
    const results = await Promise.all(promises);

    const successes = results.filter(r => r.statusCode === 200).length;
    const rateLimited = results.filter(r => r.statusCode === 429).length;

    expect(successes).toBeGreaterThanOrEqual(1);
    expect(rateLimited).toBeGreaterThanOrEqual(1);
    expect(successes + rateLimited).toBe(10);
  });

  it('handles 100 sequential requests without errors', async () => {
    const config = makeConfig(mockPort);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    for (let i = 0; i < 100; i++) {
      const res = await makeRequest(app);
      expect(res.statusCode).toBe(200);
    }
  });
});
