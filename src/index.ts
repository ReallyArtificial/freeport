import { loadConfig } from './config/loader.js';
import { initDb, closeDb } from './db/connection.js';
import { runMigrations } from './db/migrations/runner.js';
import { initLogger, getLogger } from './logging/logger.js';
import { ProviderRegistry } from './providers/registry.js';
import { loadDbProviderConfigs } from './providers/manager.js';
import { createServer } from './server.js';
import { initBuiltinGuardrails, loadCustomPlugins } from './guardrails/engine.js';
import { initEmbedder } from './cache/embedder.js';
import { initVectorCache } from './cache/semantic.js';
import { startRetentionCleanup } from './logging/retention.js';
import { resolve } from 'node:path';

async function main() {
  // --production flag: enforce required config
  const isProduction = process.argv.includes('--production') || process.env.NODE_ENV === 'production';

  // Load configuration
  const config = loadConfig();

  if (isProduction) {
    const errors: string[] = [];
    if (!config.auth?.adminApiKey) errors.push('auth.adminApiKey (or FREEPORT_ADMIN_API_KEY env var)');
    if (!config.auth?.apiKey) errors.push('auth.apiKey (or FREEPORT_API_KEY env var)');
    if (errors.length > 0) {
      console.error(`\n  PRODUCTION MODE: Missing required configuration:\n`);
      for (const e of errors) console.error(`    - ${e}`);
      console.error(`\n  Set these values in your config file or environment, or remove --production flag.\n`);
      process.exit(1);
    }
  }

  // Initialize logger
  const log = initLogger(config.logging?.level);
  log.info('Starting Freeport LLM Gateway');

  // Initialize database
  const dbPath = resolve(process.cwd(), config.database?.path ?? './data/freeport.db');
  log.info({ path: dbPath }, 'Initializing database');
  const db = initDb(dbPath);
  runMigrations(db);

  // Register providers from config file / env vars
  const registry = new ProviderRegistry();
  for (const providerConfig of config.providers) {
    registry.register(providerConfig);
    log.info({ provider: providerConfig.name, type: providerConfig.type }, 'Registered provider (config)');
  }

  // Register providers from database (added via admin UI)
  const dbProviders = loadDbProviderConfigs();
  for (const providerConfig of dbProviders) {
    if (!registry.get(providerConfig.name)) {
      registry.register(providerConfig);
      log.info({ provider: providerConfig.name, type: providerConfig.type }, 'Registered provider (database)');
    }
  }

  // Initialize guardrails
  if (config.guardrails?.enabled) {
    initBuiltinGuardrails(config.guardrails);
    if (config.guardrails.customPlugins?.length) {
      const pluginPaths = config.guardrails.customPlugins.map(p =>
        resolve(process.cwd(), 'plugins', p)
      );
      await loadCustomPlugins(pluginPaths);
    }
    log.info('Guardrails initialized');
  }

  // Initialize semantic cache
  if (config.cache?.enabled) {
    log.info('Initializing semantic cache...');
    // Init embedder in background (model download can be slow)
    initEmbedder().catch(err => log.warn({ err }, 'Embedder init failed'));
    await initVectorCache();
    log.info('Semantic cache ready');
  }

  // Start log retention cleanup (30 days default)
  startRetentionCleanup(30);

  // Create and start server
  const app = await createServer(config, registry);

  const host = config.server.host;
  const port = config.server.port;

  await app.listen({ host, port });

  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  log.info({ host, port }, `Freeport Gateway listening on http://${displayHost}:${port}`);

  if (registry.getAll().size === 0) {
    log.warn('');
    log.warn('=======================================================');
    log.warn('  No LLM providers configured!');
    log.warn(`  Open http://${displayHost}:${port}/ui/ to set up your API keys`);
    log.warn('=======================================================');
    log.warn('');
  } else {
    log.info(`Admin UI: http://${displayHost}:${port}/ui/`);
    log.info(`Health: http://${displayHost}:${port}/health`);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutting down...');
    await app.close();
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
