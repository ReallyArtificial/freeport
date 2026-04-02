import { getLogger } from '../logging/logger.js';
import type { GuardrailConfig } from '../config/types.js';

export interface GuardrailResult {
  passed: boolean;
  guardrail: string;
  message?: string;
  details?: unknown;
  modified?: string; // Optionally return modified text
}

export interface GuardrailPlugin {
  name: string;
  /** Check input before sending to LLM */
  checkInput?(text: string): GuardrailResult;
  /** Check output after receiving from LLM */
  checkOutput?(text: string): GuardrailResult;
}

const plugins: GuardrailPlugin[] = [];

export function registerPlugin(plugin: GuardrailPlugin): void {
  plugins.push(plugin);
  getLogger().info({ plugin: plugin.name }, 'Registered guardrail plugin');
}

export function runInputGuardrails(text: string): {
  passed: boolean;
  results: GuardrailResult[];
  modifiedText: string;
} {
  const results: GuardrailResult[] = [];
  let currentText = text;

  for (const plugin of plugins) {
    if (!plugin.checkInput) continue;

    const result = plugin.checkInput(currentText);
    results.push(result);

    if (!result.passed) {
      return { passed: false, results, modifiedText: currentText };
    }

    if (result.modified) {
      currentText = result.modified;
    }
  }

  return { passed: true, results, modifiedText: currentText };
}

export function runOutputGuardrails(text: string): {
  passed: boolean;
  results: GuardrailResult[];
  modifiedText: string;
} {
  const results: GuardrailResult[] = [];
  let currentText = text;

  for (const plugin of plugins) {
    if (!plugin.checkOutput) continue;

    const result = plugin.checkOutput(currentText);
    results.push(result);

    if (!result.passed) {
      return { passed: false, results, modifiedText: currentText };
    }

    if (result.modified) {
      currentText = result.modified;
    }
  }

  return { passed: true, results, modifiedText: currentText };
}

export async function loadCustomPlugins(pluginPaths: string[]): Promise<void> {
  const log = getLogger();

  for (const pluginPath of pluginPaths) {
    try {
      const mod = await import(pluginPath);
      if (mod.default && typeof mod.default === 'object' && mod.default.name) {
        registerPlugin(mod.default as GuardrailPlugin);
      } else if (mod.plugin && typeof mod.plugin === 'object') {
        registerPlugin(mod.plugin as GuardrailPlugin);
      }
    } catch (err) {
      log.error({ pluginPath, err }, 'Failed to load custom guardrail plugin');
    }
  }
}

export function initBuiltinGuardrails(config: GuardrailConfig): void {
  if (!config.enabled) return;

  // Import and register built-in plugins
  if (config.piiDetection) {
    import('./builtin/pii-detector.js').then(m => registerPlugin(m.piiDetectorPlugin));
  }
  if (config.contentFilter) {
    import('./builtin/content-filter.js').then(m => registerPlugin(m.contentFilterPlugin));
  }
  if (config.maxTokens) {
    import('./builtin/token-limit.js').then(m => registerPlugin(m.createTokenLimitPlugin(config.maxTokens!)));
  }
}
