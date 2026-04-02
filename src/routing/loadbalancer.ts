import type { ProviderKeyConfig } from '../config/types.js';

/**
 * Weighted round-robin load balancer for provider API keys.
 */
export class LoadBalancer {
  private keys: ProviderKeyConfig[];
  private index = 0;

  constructor(keys: ProviderKeyConfig[]) {
    this.keys = keys;
  }

  /** Get the next API key using weighted round-robin */
  nextKey(): string {
    if (this.keys.length === 0) {
      throw new Error('No API keys configured');
    }

    if (this.keys.length === 1) {
      return this.keys[0].key;
    }

    // Simple round-robin for now (weighted selection could be added)
    const key = this.keys[this.index % this.keys.length];
    this.index++;
    return key.key;
  }

  getKeyCount(): number {
    return this.keys.length;
  }
}

/** Cache of load balancers per provider */
const balancers = new Map<string, LoadBalancer>();

export function getOrCreateBalancer(providerName: string, keys: ProviderKeyConfig[]): LoadBalancer {
  let balancer = balancers.get(providerName);
  if (!balancer) {
    balancer = new LoadBalancer(keys);
    balancers.set(providerName, balancer);
  }
  return balancer;
}
