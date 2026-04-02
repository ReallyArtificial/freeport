import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config/loader.js';

describe('Config Loader', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env vars
    process.env = { ...originalEnv };
  });

  it('builds config from env vars when no YAML file exists', () => {
    process.env.FREEPORT_OPENAI_API_KEY = 'sk-test-key';
    process.env.FREEPORT_ADMIN_API_KEY = 'admin-secret';
    process.env.FREEPORT_API_KEY = 'proxy-secret';

    const config = loadConfig('/nonexistent/path.yaml');

    expect(config.providers).toHaveLength(1);
    expect(config.providers[0].name).toBe('openai');
    expect(config.providers[0].type).toBe('openai');
    expect(config.providers[0].keys[0].key).toBe('sk-test-key');
    expect(config.auth?.adminApiKey).toBe('admin-secret');
    expect(config.auth?.apiKey).toBe('proxy-secret');
  });

  it('applies default values', () => {
    process.env.FREEPORT_OPENAI_API_KEY = 'sk-test';

    const config = loadConfig('/nonexistent/path.yaml');

    expect(config.server.host).toBe('0.0.0.0');
    expect(config.server.port).toBe(4000);
    expect(config.cache?.enabled).toBe(false);
    expect(config.rateLimit?.enabled).toBe(false);
    expect(config.guardrails?.enabled).toBe(false);
    expect(config.budget?.enforcementMode).toBe('hard');
  });

  it('registers multiple providers from env vars', () => {
    process.env.FREEPORT_OPENAI_API_KEY = 'sk-openai';
    process.env.FREEPORT_ANTHROPIC_API_KEY = 'sk-anthropic';
    process.env.FREEPORT_GOOGLE_API_KEY = 'google-key';

    const config = loadConfig('/nonexistent/path.yaml');

    expect(config.providers).toHaveLength(3);
    const names = config.providers.map(p => p.type);
    expect(names).toContain('openai');
    expect(names).toContain('anthropic');
    expect(names).toContain('google');
  });

  it('throws on invalid config', () => {
    // No providers at all
    delete process.env.FREEPORT_OPENAI_API_KEY;
    delete process.env.FREEPORT_ANTHROPIC_API_KEY;
    delete process.env.FREEPORT_GOOGLE_API_KEY;

    expect(() => loadConfig('/nonexistent/path.yaml')).toThrow('Config validation failed');
  });
});
