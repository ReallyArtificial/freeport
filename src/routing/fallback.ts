import type { FallbackChainConfig } from '../config/types.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { CompletionRequest, ProviderResponse, StreamingProviderResponse } from '../providers/base.js';
import { getOrCreateBalancer } from './loadbalancer.js';
import { AllProvidersFailedError } from '../utils/errors.js';
import { getLogger } from '../logging/logger.js';

interface CircuitState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

const circuitStates = new Map<string, CircuitState>();

function getCircuitState(providerName: string): CircuitState {
  let state = circuitStates.get(providerName);
  if (!state) {
    state = { failures: 0, lastFailure: 0, isOpen: false };
    circuitStates.set(providerName, state);
  }
  return state;
}

function recordFailure(providerName: string, threshold: number): void {
  const state = getCircuitState(providerName);
  state.failures++;
  state.lastFailure = Date.now();
  if (state.failures >= threshold) {
    state.isOpen = true;
    getLogger().warn(
      { provider: providerName, failures: state.failures, threshold },
      'Circuit breaker opened for provider',
    );
  }
}

function recordSuccess(providerName: string): void {
  const state = getCircuitState(providerName);
  if (state.isOpen) {
    getLogger().info({ provider: providerName }, 'Circuit breaker closed after successful request');
  }
  state.failures = 0;
  state.isOpen = false;
}

function isCircuitOpen(providerName: string, resetTimeoutMs: number): boolean {
  const state = getCircuitState(providerName);
  if (!state.isOpen) return false;

  // Check if enough time has passed to try again (half-open)
  if (Date.now() - state.lastFailure > resetTimeoutMs) {
    getLogger().info({ provider: providerName }, 'Circuit breaker entering half-open state');
    // Only reset isOpen, keep failure count until success confirms recovery
    state.isOpen = false;
    return false;
  }
  return true;
}

/** Reset all circuit breaker states (for testing) */
export function resetCircuitBreakers(): void {
  circuitStates.clear();
}

export async function executeWithFallback(
  request: CompletionRequest,
  chain: FallbackChainConfig,
  registry: ProviderRegistry,
): Promise<ProviderResponse> {
  const log = getLogger();
  const errors: Array<{ provider: string; error: string }> = [];
  const threshold = chain.circuitBreaker?.failureThreshold ?? 3;
  const resetTimeout = chain.circuitBreaker?.resetTimeoutMs ?? 60000;

  for (const providerName of chain.providers) {
    if (isCircuitOpen(providerName, resetTimeout)) {
      log.warn({ provider: providerName }, 'Circuit breaker open, skipping provider');
      errors.push({ provider: providerName, error: 'Circuit breaker open' });
      continue;
    }

    const provider = registry.get(providerName);
    const config = registry.getConfig(providerName);
    if (!provider || !config) {
      errors.push({ provider: providerName, error: 'Provider not found' });
      continue;
    }

    try {
      const balancer = getOrCreateBalancer(providerName, config.keys);
      const apiKey = balancer.nextKey();
      const result = await provider.chatCompletion(request, apiKey);
      recordSuccess(providerName);
      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error({ provider: providerName, error: errMsg }, 'Provider failed, trying next');
      recordFailure(providerName, threshold);
      errors.push({ provider: providerName, error: errMsg });
    }
  }

  throw new AllProvidersFailedError(errors);
}

export async function executeWithFallbackStream(
  request: CompletionRequest,
  chain: FallbackChainConfig,
  registry: ProviderRegistry,
): Promise<StreamingProviderResponse> {
  const log = getLogger();
  const errors: Array<{ provider: string; error: string }> = [];
  const threshold = chain.circuitBreaker?.failureThreshold ?? 3;
  const resetTimeout = chain.circuitBreaker?.resetTimeoutMs ?? 60000;

  for (const providerName of chain.providers) {
    if (isCircuitOpen(providerName, resetTimeout)) {
      log.warn({ provider: providerName }, 'Circuit breaker open, skipping provider');
      errors.push({ provider: providerName, error: 'Circuit breaker open' });
      continue;
    }

    const provider = registry.get(providerName);
    const config = registry.getConfig(providerName);
    if (!provider || !config) {
      errors.push({ provider: providerName, error: 'Provider not found' });
      continue;
    }

    try {
      const balancer = getOrCreateBalancer(providerName, config.keys);
      const apiKey = balancer.nextKey();
      const result = await provider.chatCompletionStream(request, apiKey);
      recordSuccess(providerName);
      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error({ provider: providerName, error: errMsg }, 'Provider stream failed, trying next');
      recordFailure(providerName, threshold);
      errors.push({ provider: providerName, error: errMsg });
    }
  }

  throw new AllProvidersFailedError(errors);
}
