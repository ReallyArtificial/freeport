export const configSchema = {
  type: 'object',
  required: ['server', 'providers'],
  properties: {
    server: {
      type: 'object',
      required: ['port'],
      properties: {
        host: { type: 'string', default: '0.0.0.0' },
        port: { type: 'integer', minimum: 1, maximum: 65535 },
      },
    },
    providers: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['name', 'type', 'keys'],
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['openai', 'anthropic', 'google'] },
          apiBase: { type: 'string' },
          keys: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['key'],
              properties: {
                key: { type: 'string' },
                weight: { type: 'number', minimum: 0, default: 1 },
              },
            },
          },
          models: { type: 'array', items: { type: 'string' } },
          enabled: { type: 'boolean', default: true },
        },
      },
    },
    fallbackChains: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'providers'],
        properties: {
          name: { type: 'string' },
          providers: { type: 'array', items: { type: 'string' } },
          circuitBreaker: {
            type: 'object',
            properties: {
              failureThreshold: { type: 'integer', default: 3 },
              resetTimeoutMs: { type: 'integer', default: 60000 },
            },
          },
        },
      },
    },
    budget: {
      type: 'object',
      properties: {
        defaultProjectBudget: { type: 'number' },
        currency: { type: 'string', default: 'USD' },
        enforcementMode: { type: 'string', enum: ['hard', 'warn'], default: 'hard' },
      },
    },
    cache: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: false },
        similarityThreshold: { type: 'number', minimum: 0, maximum: 1, default: 0.95 },
        maxEntries: { type: 'integer', default: 10000 },
        ttlSeconds: { type: 'integer', default: 3600 },
      },
    },
    rateLimit: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: false },
        requestsPerMinute: { type: 'integer', default: 60 },
        tokensPerMinute: { type: 'integer', default: 100000 },
      },
    },
    guardrails: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: false },
        piiDetection: { type: 'boolean', default: true },
        contentFilter: { type: 'boolean', default: true },
        maxTokens: { type: 'integer' },
        customPlugins: { type: 'array', items: { type: 'string' } },
      },
    },
    abTesting: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: false },
      },
    },
    logging: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'], default: 'info' },
        requestLogging: { type: 'boolean', default: true },
      },
    },
    auth: {
      type: 'object',
      properties: {
        adminApiKey: { type: 'string' },
        apiKey: { type: 'string' },
      },
    },
    database: {
      type: 'object',
      properties: {
        path: { type: 'string', default: './data/freeport.db' },
      },
    },
  },
} as const;
