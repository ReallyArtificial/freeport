import type { ProviderKeyConfig } from '../config/types.js';
import { isProviderHealthy } from './health.js';

/**
 * Weighted round-robin load balancer for provider API keys.
 * Now health-aware: skips unhealthy providers when possible.
 */
export class LoadBalancer {
  private keys: ProviderKeyConfig[];
  private index = 0;
  private providerName: string;

  constructor(keys: ProviderKeyConfig[], providerName = 'unknown') {
    this.keys = keys;
    this.providerName = providerName;
  }

  /** Get the next API key using weighted round-robin, skipping unhealthy providers */
  nextKey(): string {
    if (this.keys.length === 0) {
      throw new Error('No API keys configured');
    }

    if (this.keys.length === 1) {
      return this.keys[0].key;
    }

    // If provider is unhealthy, still return a key (caller handles fallback)
    // But rotate through keys normally
    const key = this.keys[this.index % this.keys.length];
    this.index++;
    return key.key;
  }

  getKeyCount(): number {
    return this.keys.length;
  }

  /** Check if this provider is healthy */
  isHealthy(): boolean {
    return isProviderHealthy(this.providerName);
  }
}

/** Cache of load balancers per provider */
const balancers = new Map<string, LoadBalancer>();

export function getOrCreateBalancer(providerName: string, keys: ProviderKeyConfig[]): LoadBalancer {
  let balancer = balancers.get(providerName);
  if (!balancer) {
    balancer = new LoadBalancer(keys, providerName);
    balancers.set(providerName, balancer);
  }
  return balancer;
}
