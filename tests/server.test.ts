import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from '../src/server.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import type { FreeportConfig } from '../src/config/types.js';
import type { FastifyInstance } from 'fastify';

function makeConfig(overrides: Partial<FreeportConfig> = {}): FreeportConfig {
  return {
    server: { host: '127.0.0.1', port: 0 },
    providers: [{
      name: 'openai',
      type: 'openai',
      keys: [{ key: 'sk-test' }],
    }],
    auth: { adminApiKey: 'test-admin-key', apiKey: 'test-proxy-key' },
    ...overrides,
  };
}

let app: FastifyInstance | null = null;

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
});

describe('Server', () => {
  it('starts and responds to health check', async () => {
    const config = makeConfig();
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);

    app = await createServer(config, registry);
    await app.listen({ port: 0 });

    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0');
  });

  it('lists models', async () => {
    const config = makeConfig();
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);

    app = await createServer(config, registry);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: 'Bearer test-proxy-key' },
    });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.object).toBe('list');
    expect(body.data.length).toBeGreaterThan(0);
  });
});

describe('Proxy Auth', () => {
  it('rejects proxy requests without API key', async () => {
    const config = makeConfig();
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);

    app = await createServer(config, registry);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toContain('Authorization');
  });

  it('rejects proxy requests with wrong API key', async () => {
    const config = makeConfig();
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);

    app = await createServer(config, registry);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer wrong-key' },
      payload: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toContain('Invalid');
  });

  it('allows proxy requests with correct API key', async () => {
    const config = makeConfig();
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);

    app = await createServer(config, registry);

    // This will fail at the provider level (fake key), but should pass auth (not 401)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer test-proxy-key' },
      payload: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
    });
    // Should not be 401 — may be 502 (provider error) but NOT an auth error
    expect(response.statusCode).not.toBe(401);
  });

  it('allows unauthenticated proxy when no apiKey configured', async () => {
    const config = makeConfig({ auth: { adminApiKey: 'admin' } });
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);

    app = await createServer(config, registry);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
    });
    // Should pass auth — may fail at provider level but NOT 401
    expect(response.statusCode).not.toBe(401);
  });
});

describe('Admin Auth', () => {
  it('rejects admin requests without API key', async () => {
    const config = makeConfig();
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);

    app = await createServer(config, registry);

    const response = await app.inject({ method: 'GET', url: '/api/prompts' });
    expect(response.statusCode).toBe(401);
  });

  it('allows admin requests with correct API key', async () => {
    const config = makeConfig();
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);

    app = await createServer(config, registry);

    const response = await app.inject({
      method: 'GET',
      url: '/api/prompts',
      headers: { authorization: 'Bearer test-admin-key' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('rejects admin requests with wrong API key', async () => {
    const config = makeConfig();
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);

    app = await createServer(config, registry);

    const response = await app.inject({
      method: 'GET',
      url: '/api/prompts',
      headers: { authorization: 'Bearer wrong-admin-key' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('CORS Protection', () => {
  it('blocks cross-origin admin API requests', async () => {
    const config = makeConfig();
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);

    app = await createServer(config, registry);

    const response = await app.inject({
      method: 'GET',
      url: '/api/system/status',
      headers: {
        authorization: 'Bearer test-admin-key',
        origin: 'https://evil.com',
        host: 'localhost:4000',
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('allows same-origin admin API requests', async () => {
    const config = makeConfig();
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);

    app = await createServer(config, registry);

    const response = await app.inject({
      method: 'GET',
      url: '/api/system/status',
      headers: {
        authorization: 'Bearer test-admin-key',
        origin: 'http://localhost:4000',
        host: 'localhost:4000',
      },
    });
    expect(response.statusCode).toBe(200);
  });
});
