export interface ProviderKeyConfig {
  key: string;
  weight?: number;
}

export interface ProviderConfig {
  name: string;
  type: 'openai' | 'anthropic' | 'google';
  apiBase?: string;
  keys: ProviderKeyConfig[];
  models?: string[];
  enabled?: boolean;
}

export interface FallbackChainConfig {
  name: string;
  providers: string[];
  circuitBreaker?: {
    failureThreshold: number;
    resetTimeoutMs: number;
  };
}

export interface BudgetConfig {
  defaultProjectBudget?: number;
  currency?: string;
  enforcementMode?: 'hard' | 'warn';
}

export interface CacheConfig {
  enabled: boolean;
  similarityThreshold?: number;
  maxEntries?: number;
  ttlSeconds?: number;
}

export interface RateLimitConfig {
  enabled: boolean;
  requestsPerMinute?: number;
  tokensPerMinute?: number;
}

export interface GuardrailConfig {
  enabled: boolean;
  piiDetection?: boolean;
  contentFilter?: boolean;
  maxTokens?: number;
  customPlugins?: string[];
}

export interface ServerConfig {
  host: string;
  port: number;
}

export interface ABTestConfig {
  enabled: boolean;
}

export interface FreeportConfig {
  server: ServerConfig;
  providers: ProviderConfig[];
  fallbackChains?: FallbackChainConfig[];
  budget?: BudgetConfig;
  cache?: CacheConfig;
  rateLimit?: RateLimitConfig;
  guardrails?: GuardrailConfig;
  abTesting?: ABTestConfig;
  logging?: {
    level?: string;
    requestLogging?: boolean;
  };
  auth?: {
    adminApiKey?: string;
    apiKey?: string;
  };
  database?: {
    path?: string;
  };
}
