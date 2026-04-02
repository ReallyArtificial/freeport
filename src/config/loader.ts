import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { default as _Ajv } from 'ajv';
const Ajv = _Ajv as unknown as typeof _Ajv.default;
import { configSchema } from './schema.js';
import type { FreeportConfig } from './types.js';

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

function interpolateEnvVars(text: string): string {
  return text.replace(ENV_VAR_PATTERN, (_, varExpr: string) => {
    const [varName, defaultVal] = varExpr.split(':-');
    const value = process.env[varName.trim()];
    if (value !== undefined) return value;
    if (defaultVal !== undefined) return defaultVal;
    throw new Error(`Environment variable ${varName.trim()} is not set and has no default`);
  });
}

function applyDefaults(config: Partial<FreeportConfig>): FreeportConfig {
  return {
    server: {
      host: config.server?.host ?? '0.0.0.0',
      port: config.server?.port ?? 4000,
    },
    providers: config.providers ?? [],
    fallbackChains: config.fallbackChains ?? [],
    budget: {
      defaultProjectBudget: config.budget?.defaultProjectBudget ?? 100,
      currency: config.budget?.currency ?? 'USD',
      enforcementMode: config.budget?.enforcementMode ?? 'hard',
    },
    cache: {
      enabled: config.cache?.enabled ?? false,
      similarityThreshold: config.cache?.similarityThreshold ?? 0.95,
      maxEntries: config.cache?.maxEntries ?? 10000,
      ttlSeconds: config.cache?.ttlSeconds ?? 3600,
    },
    rateLimit: {
      enabled: config.rateLimit?.enabled ?? false,
      requestsPerMinute: config.rateLimit?.requestsPerMinute ?? 60,
      tokensPerMinute: config.rateLimit?.tokensPerMinute ?? 100000,
    },
    guardrails: {
      enabled: config.guardrails?.enabled ?? false,
      piiDetection: config.guardrails?.piiDetection ?? true,
      contentFilter: config.guardrails?.contentFilter ?? true,
      maxTokens: config.guardrails?.maxTokens,
      customPlugins: config.guardrails?.customPlugins ?? [],
    },
    abTesting: {
      enabled: config.abTesting?.enabled ?? false,
    },
    logging: {
      level: config.logging?.level ?? 'info',
      requestLogging: config.logging?.requestLogging ?? true,
    },
    auth: {
      adminApiKey: config.auth?.adminApiKey,
      apiKey: config.auth?.apiKey,
    },
    database: {
      path: config.database?.path ?? './data/freeport.db',
    },
  };
}

export function loadConfig(configPath?: string): FreeportConfig {
  const paths = [
    configPath,
    process.env.FREEPORT_CONFIG,
    resolve(process.cwd(), 'config', 'freeport.yaml'),
    resolve(process.cwd(), 'config', 'freeport.yml'),
    resolve(process.cwd(), 'freeport.yaml'),
  ].filter(Boolean) as string[];

  let rawContent: string | undefined;
  let resolvedPath: string | undefined;

  for (const p of paths) {
    if (existsSync(p)) {
      rawContent = readFileSync(p, 'utf-8');
      resolvedPath = p;
      break;
    }
  }

  let parsed: Record<string, unknown>;
  if (rawContent && resolvedPath) {
    const interpolated = interpolateEnvVars(rawContent);
    parsed = parseYaml(interpolated) as Record<string, unknown>;
  } else {
    // Build config from env vars only
    parsed = buildConfigFromEnv();
  }

  const ajv = new Ajv({ allErrors: true, useDefaults: true });
  const validate = ajv.compile(configSchema);
  const valid = validate(parsed);

  if (!valid) {
    const errors = validate.errors?.map((e: { instancePath: string; message?: string }) => `${e.instancePath} ${e.message}`).join('; ');
    throw new Error(`Config validation failed: ${errors}`);
  }

  return applyDefaults(parsed as Partial<FreeportConfig>);
}

function buildConfigFromEnv(): Record<string, unknown> {
  const config: Record<string, unknown> = {
    server: {
      host: process.env.FREEPORT_HOST ?? '0.0.0.0',
      port: parseInt(process.env.FREEPORT_PORT ?? '4000', 10),
    },
    providers: [] as unknown[],
  };

  // Support FREEPORT_OPENAI_API_KEY for quick single-provider setup
  if (process.env.FREEPORT_OPENAI_API_KEY) {
    (config.providers as unknown[]).push({
      name: 'openai',
      type: 'openai',
      keys: [{ key: process.env.FREEPORT_OPENAI_API_KEY }],
    });
  }
  if (process.env.FREEPORT_ANTHROPIC_API_KEY) {
    (config.providers as unknown[]).push({
      name: 'anthropic',
      type: 'anthropic',
      keys: [{ key: process.env.FREEPORT_ANTHROPIC_API_KEY }],
    });
  }
  if (process.env.FREEPORT_GOOGLE_API_KEY) {
    (config.providers as unknown[]).push({
      name: 'google',
      type: 'google',
      keys: [{ key: process.env.FREEPORT_GOOGLE_API_KEY }],
    });
  }

  const auth: Record<string, string> = {};
  if (process.env.FREEPORT_ADMIN_API_KEY) auth.adminApiKey = process.env.FREEPORT_ADMIN_API_KEY;
  if (process.env.FREEPORT_API_KEY) auth.apiKey = process.env.FREEPORT_API_KEY;
  if (Object.keys(auth).length > 0) config.auth = auth;

  return config;
}
