import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { FreeportConfig } from './config/types.js';
import type { ProviderRegistry } from './providers/registry.js';
import { createProxyHandler } from './proxy/handler.js';
import { registerAdminRoutes } from './admin/routes.js';
import { getLogger } from './logging/logger.js';

export async function createServer(config: FreeportConfig, registry: ProviderRegistry) {
  const log = getLogger();

  const app = Fastify({
    logger: false, // We use our own pino logger
    bodyLimit: 10 * 1024 * 1024, // 10MB
  });

  // CORS — restrict admin API, allow broad access for proxy routes
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Block cross-origin requests to admin API unless from same origin
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      const origin = request.headers.origin;
      const host = request.headers.host;
      // If there's an Origin header and it doesn't match the host, block it
      if (origin && host) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== host) {
            reply.header('Access-Control-Allow-Origin', '');
            return reply.status(403).send({ error: { message: 'Cross-origin admin requests not allowed' } });
          }
        } catch {
          // Malformed origin — block it
          return reply.status(403).send({ error: { message: 'Invalid origin' } });
        }
      }
    }
  });

  // Error handler
  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    log.error({ err: error.message, statusCode }, 'Request error');

    reply.status(statusCode).send({
      error: {
        message: error.message,
        type: error.code ?? 'internal_error',
        code: statusCode,
      },
    });
  });

  // Health endpoint
  app.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    };
  });

  // Proxy auth — supports both FREEPORT_API_KEY and fport_ database keys
  const proxyApiKey = config.auth?.apiKey;
  const { createHash, timingSafeEqual } = await import('node:crypto');
  const { validateApiKey } = await import('./admin/api-keys.js');

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/v1/')) return;
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      if (!proxyApiKey) return; // No auth configured, allow through
      return reply.status(401).send({
        error: { message: 'Missing Authorization header. Use: Authorization: Bearer <API_KEY>', type: 'auth_error' },
      });
    }
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    // Check for fport_ database keys first
    if (token.startsWith('fport_')) {
      const apiKeyRow = validateApiKey(token);
      if (!apiKeyRow) {
        return reply.status(401).send({
          error: { message: 'Invalid or revoked API key', type: 'auth_error' },
        });
      }
      // Attach context to request for downstream use
      (request as any).freeportContext = {
        projectId: apiKeyRow.project_id,
        apiKeyId: apiKeyRow.id,
      };
      return;
    }

    // Fall back to static FREEPORT_API_KEY check
    if (proxyApiKey) {
      const hashA = createHash('sha256').update(token).digest();
      const hashB = createHash('sha256').update(proxyApiKey).digest();
      if (!timingSafeEqual(hashA, hashB)) {
        return reply.status(401).send({
          error: { message: 'Invalid API key', type: 'auth_error' },
        });
      }
    }
  });

  if (proxyApiKey) {
    log.info('Proxy API key authentication enabled (static + database keys)');
  } else {
    log.info('Proxy authentication: database API keys only (no static FREEPORT_API_KEY)');
  }

  // Proxy routes (OpenAI-compatible)
  const proxyHandler = createProxyHandler(config, registry);

  app.post('/v1/chat/completions', proxyHandler);
  app.post('/v1/completions', proxyHandler);

  // Embeddings passthrough
  app.post('/v1/embeddings', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const model = body.model as string ?? 'text-embedding-3-small';

    const match = registry.findProviderForModel(model);
    if (!match) {
      return reply.status(400).send({ error: { message: 'No provider found for embedding model' } });
    }

    const balancer = (await import('./routing/loadbalancer.js')).getOrCreateBalancer(
      match.provider.name,
      match.config.keys,
    );

    const apiKey = balancer.nextKey();
    const apiBase = match.config.apiBase ?? 'https://api.openai.com';

    const res = await fetch(`${apiBase}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const result = await res.json();
    return reply.status(res.status).send(result);
  });

  // Models list
  app.get('/v1/models', async () => {
    const models: Array<{ id: string; object: string; owned_by: string }> = [];

    for (const [, config] of registry.getAllConfigs()) {
      if (config.models) {
        for (const model of config.models) {
          models.push({ id: model, object: 'model', owned_by: config.name });
        }
      }
    }

    // Default models if none configured
    if (models.length === 0) {
      for (const [, providerConfig] of registry.getAllConfigs()) {
        const defaults = getDefaultModels(providerConfig.type);
        for (const model of defaults) {
          models.push({ id: model, object: 'model', owned_by: providerConfig.name });
        }
      }
    }

    return { object: 'list', data: models };
  });

  // Admin API routes
  registerAdminRoutes(app, config, registry);

  // Serve admin UI (must be pre-built via `npm run build:ui`)
  const uiDir = resolve(process.cwd(), 'admin-ui');
  const uiPath = resolve(uiDir, 'dist');

  if (!existsSync(uiPath)) {
    log.warn('Admin UI not built — run "npm run build:ui" to enable the dashboard at /ui/');
  }

  if (existsSync(uiPath)) {
    await app.register(fastifyStatic, {
      root: uiPath,
      prefix: '/ui/',
    });

    app.get('/ui', async (_, reply) => {
      return reply.redirect('/ui/');
    });
  }

  return app;
}

function getDefaultModels(type: string): string[] {
  switch (type) {
    case 'openai': return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
    case 'anthropic': return ['claude-sonnet-4-5-20250929', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'];
    case 'google': return ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'];
    default: return [];
  }
}
