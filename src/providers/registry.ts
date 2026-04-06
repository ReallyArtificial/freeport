import type { LLMProvider } from './base.js';
import type { ProviderConfig } from '../config/types.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { GoogleProvider } from './google.js';

export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();
  private configs = new Map<string, ProviderConfig>();

  register(config: ProviderConfig): void {
    if (config.enabled === false) return;

    let provider: LLMProvider;
    switch (config.type) {
      case 'openai':
        provider = new OpenAIProvider(config.name, config.apiBase);
        break;
      case 'anthropic':
        provider = new AnthropicProvider(config.name, config.apiBase);
        break;
      case 'google':
        provider = new GoogleProvider(config.name, config.apiBase);
        break;
      default:
        throw new Error(`Unknown provider type: ${config.type}`);
    }

    this.providers.set(config.name, provider);
    this.configs.set(config.name, config);
  }

  unregister(name: string): void {
    this.providers.delete(name);
    this.configs.delete(name);
  }

  get(name: string): LLMProvider | undefined {
    return this.providers.get(name);
  }

  getConfig(name: string): ProviderConfig | undefined {
    return this.configs.get(name);
  }

  getAll(): Map<string, LLMProvider> {
    return this.providers;
  }

  getAllConfigs(): Map<string, ProviderConfig> {
    return this.configs;
  }

  /** Find which provider serves a given model */
  findProviderForModel(model: string): { provider: LLMProvider; config: ProviderConfig } | undefined {
    // Check explicit model lists first
    for (const [name, config] of this.configs) {
      if (config.models && config.models.includes(model)) {
        const provider = this.providers.get(name);
        if (provider) return { provider, config };
      }
    }

    // Heuristic: match by model prefix
    if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')) {
      return this.findByType('openai');
    }
    if (model.startsWith('claude-')) {
      return this.findByType('anthropic');
    }
    if (model.startsWith('gemini-')) {
      return this.findByType('google');
    }

    // Default to first provider
    const first = this.providers.entries().next();
    if (!first.done) {
      const config = this.configs.get(first.value[0]);
      if (config) return { provider: first.value[1], config };
    }

    return undefined;
  }

  private findByType(type: string): { provider: LLMProvider; config: ProviderConfig } | undefined {
    for (const [name, config] of this.configs) {
      if (config.type === type) {
        const provider = this.providers.get(name);
        if (provider) return { provider, config };
      }
    }
    return undefined;
  }
}
