import type { FastifyRequest, FastifyReply } from 'fastify';
import type { FreeportConfig, FallbackChainConfig } from '../config/types.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type {
  ChatMessage,
  CompletionResponse,
  StreamingProviderResponse,
} from '../providers/base.js';
import { getMessageText } from '../providers/base.js';
import { normalizeRequest, extractFreeportMetadata } from './transformer.js';
import { preProcess, postProcess, type PipelineContext } from './pipeline.js';
import { pipeStream } from './streaming.js';
import { executeWithFallback, executeWithFallbackStream } from '../routing/fallback.js';
import { recordABResult, getActiveTests, selectVariant } from '../routing/ab-router.js';
import { getLogger } from '../logging/logger.js';
import { incCounter, observeHistogram, incGauge, decGauge } from '../observability/metrics.js';

/**
 * Result of running the proxy core. Either a fully-formed (cache or provider)
 * response, or a streaming handle plus a `finalize(fullContent)` callback that
 * runs post-processing once the stream has been drained.
 */
export type RunCompletionResult =
  | {
      kind: 'response';
      response: CompletionResponse;
      cacheHeaders?: Record<string, string>;
    }
  | {
      kind: 'stream';
      streamResponse: StreamingProviderResponse;
      finalize: (fullContent: string) => Promise<void>;
      isFallback: boolean;
    };

/**
 * Shared proxy core: runs the full pipeline (A/B routing, pre-process, cache,
 * routing/fallback, post-process) WITHOUT touching the Fastify reply. Both the
 * OpenAI-format handler and the Anthropic-format /v1/messages ingress call this.
 *
 * `body` is the raw client body (OpenAI-shaped). `extraMetadata` lets a caller
 * (e.g. the Anthropic ingress) attach project context derived from auth.
 */
export async function runCompletion(
  body: Record<string, unknown>,
  registry: ProviderRegistry,
  config: FreeportConfig,
  startTime: number,
  freeportCtx?: { projectId?: string; apiKeyId?: string },
): Promise<RunCompletionResult> {
  const log = getLogger();

  // Parse and normalize the request
  const completionReq = normalizeRequest(body);
  const metadata = extractFreeportMetadata(body);

  // Build pipeline context
  const context: PipelineContext = {
    request: completionReq,
    projectId: metadata.projectId || freeportCtx?.projectId,
    apiKeyId: freeportCtx?.apiKeyId,
    promptSlug: metadata.promptSlug,
    promptVersion: metadata.promptVersion,
    promptVariables: metadata.promptVariables,
    cacheControl: metadata.cacheControl,
    abTestId: metadata.abTestId,
    config,
  };

  // A/B test routing
  let abVariant: ReturnType<typeof selectVariant> = null;
  if (config.abTesting?.enabled && metadata.abTestId) {
    const tests = getActiveTests();
    const test = tests.find(t => t.id === metadata.abTestId || t.name === metadata.abTestId);
    if (test) {
      abVariant = selectVariant(test);
      if (abVariant) {
        if (abVariant.model) completionReq.model = abVariant.model;
      }
    }
  }

  // Run pre-processing pipeline
  const preResult = await preProcess(context);

  // Cache hit? Return immediately
  if (preResult.cacheHit) {
    const cached = preResult.cacheHit;
    const cachedResponse: CompletionResponse = {
      id: `chatcmpl-cached-${cached.id}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: completionReq.model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: cached.responseText },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: cached.inputTokens,
        completion_tokens: cached.outputTokens,
        total_tokens: cached.inputTokens + cached.outputTokens,
      },
    };

    const latencyMs = Math.round(performance.now() - startTime);

    await postProcess({
      context,
      provider: 'cache',
      model: completionReq.model,
      responseText: cached.responseText,
      inputTokens: cached.inputTokens,
      outputTokens: cached.outputTokens,
      latencyMs,
      isCached: true,
      isFallback: false,
    });

    incCounter('freeport_cache_hits_total');
    incCounter('freeport_requests_total', { provider: 'cache', model: completionReq.model, status: '200' });
    return {
      kind: 'response',
      response: cachedResponse,
      cacheHeaders: { 'X-Cache': 'HIT', 'X-Cache-Similarity': String(cached.similarity) },
    };
  }

  // Snapshot the resolved request for logging
  const resolvedRequestBody = JSON.stringify({
    model: completionReq.model,
    messages: completionReq.messages,
    ...(completionReq.temperature !== undefined && { temperature: completionReq.temperature }),
    ...(completionReq.max_tokens !== undefined && { max_tokens: completionReq.max_tokens }),
    ...(completionReq.stream && { stream: completionReq.stream }),
  });

  const isStreaming = completionReq.stream === true;
  const chain = findChain(completionReq.model, config, registry);

  if (isStreaming) {
    const streamResponse = await executeWithFallbackStream(completionReq, chain, registry);

    const finalize = async (fullContent: string) => {
      const latencyMs = Math.round(performance.now() - startTime);
      try {
        await postProcess({
          context,
          provider: streamResponse.provider,
          model: streamResponse.model,
          responseText: fullContent,
          inputTokens: estimateTokensQuick(completionReq.messages),
          outputTokens: estimateTokensQuick([{ role: 'assistant', content: fullContent }]),
          latencyMs,
          isCached: false,
          isFallback: chain.providers.length > 1,
          rawRequestBody: resolvedRequestBody,
          rawResponseBody: fullContent,
        });
      } catch (err) {
        log.error({ err }, 'Post-process failed for streaming request');
      }

      if (abVariant) {
        recordABResult({
          testId: abVariant.testId,
          variantId: abVariant.id,
          latencyMs,
          cost: 0,
        });
      }

      incCounter('freeport_requests_total', { provider: streamResponse.provider, model: streamResponse.model, status: '200' });
      observeHistogram('freeport_request_duration_seconds', { provider: streamResponse.provider, model: streamResponse.model }, latencyMs / 1000);
      incCounter('freeport_cache_misses_total');
    };

    return { kind: 'stream', streamResponse, finalize, isFallback: chain.providers.length > 1 };
  }

  // Non-streaming path
  const providerResponse = await executeWithFallback(completionReq, chain, registry);
  const latencyMs = Math.round(performance.now() - startTime);
  const response = providerResponse.response;

  // Tool-only responses have content:null — flatten to '' for logging.
  const responseMsg = response.choices[0]?.message;
  const responseText = responseMsg ? getMessageText(responseMsg) : '';

  await postProcess({
    context,
    provider: providerResponse.provider,
    model: response.model,
    responseText,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
    latencyMs,
    isCached: false,
    isFallback: chain.providers.length > 1,
    rawRequestBody: JSON.stringify(body),
    rawResponseBody: providerResponse.rawBody,
  });

  if (abVariant) {
    recordABResult({
      testId: abVariant.testId,
      variantId: abVariant.id,
      latencyMs,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    });
  }

  incCounter('freeport_requests_total', { provider: providerResponse.provider, model: response.model, status: '200' });
  observeHistogram('freeport_request_duration_seconds', { provider: providerResponse.provider, model: response.model }, latencyMs / 1000);
  incCounter('freeport_tokens_total', { provider: providerResponse.provider, model: response.model, type: 'input' }, response.usage?.prompt_tokens ?? 0);
  incCounter('freeport_tokens_total', { provider: providerResponse.provider, model: response.model, type: 'output' }, response.usage?.completion_tokens ?? 0);
  incCounter('freeport_cache_misses_total');

  return { kind: 'response', response, cacheHeaders: { 'X-Cache': 'MISS' } };
}

export function createProxyHandler(config: FreeportConfig, registry: ProviderRegistry) {
  const log = getLogger();

  return async function handleProxy(request: FastifyRequest, reply: FastifyReply) {
    const startTime = performance.now();
    const body = request.body as Record<string, unknown>;

    const freeportCtx = (request as any).freeportContext as
      { projectId?: string; apiKeyId?: string } | undefined;

    incGauge('freeport_active_requests');
    try {
      const result = await runCompletion(body, registry, config, startTime, freeportCtx);

      if (result.kind === 'stream') {
        const { fullContent } = await pipeStream(result.streamResponse, reply);
        await result.finalize(fullContent);
        decGauge('freeport_active_requests');
        return; // Already sent via pipeStream
      }

      decGauge('freeport_active_requests');
      if (result.cacheHeaders) {
        for (const [k, v] of Object.entries(result.cacheHeaders)) reply.header(k, v);
      }
      return reply.send(result.response);
    } catch (err: unknown) {
      const latencyMs = Math.round(performance.now() - startTime);
      const error = err as Error & { statusCode?: number; code?: string };

      log.error({
        err: error.message,
        statusCode: error.statusCode,
        latencyMs,
      }, 'Proxy request failed');

      const statusCode = error.statusCode ?? 500;
      incCounter('freeport_requests_total', { provider: 'unknown', model: 'unknown', status: String(statusCode) });
      decGauge('freeport_active_requests');
      // Don't leak provider error details to clients
      const safeMessage = statusCode >= 500
        ? 'Internal server error'
        : error.message;
      return reply.status(statusCode).send({
        error: {
          message: safeMessage,
          type: error.code ?? 'internal_error',
          code: statusCode,
        },
      });
    }
  };
}

/** Build a fallback chain for the given model */
export function findChain(
  model: string,
  config: FreeportConfig,
  registry: ProviderRegistry,
): FallbackChainConfig {
  // Check explicit fallback chains from config
  if (config.fallbackChains) {
    for (const chain of config.fallbackChains) {
      for (const providerName of chain.providers) {
        const providerConfig = registry.getConfig(providerName);
        if (providerConfig?.models?.includes(model)) {
          return chain;
        }
      }
    }
  }

  // Check database fallback chains
  try {
    const { getDb } = require('../db/connection.js');
    const db = getDb();
    const dbChains = db.prepare(
      'SELECT * FROM fallback_chains WHERE enabled = 1 ORDER BY created_at ASC'
    ).all() as Array<Record<string, unknown>>;

    for (const dbChain of dbChains) {
      const providers = JSON.parse(dbChain.provider_order as string) as string[];
      for (const providerName of providers) {
        const providerConfig = registry.getConfig(providerName);
        if (providerConfig?.models?.includes(model)) {
          return {
            name: dbChain.name as string,
            providers,
            circuitBreaker: {
              failureThreshold: dbChain.failure_threshold as number,
              resetTimeoutMs: dbChain.reset_timeout_ms as number,
            },
          };
        }
      }
    }
  } catch {
    // DB not ready or table doesn't exist yet — skip
  }

  // Default: single-provider chain
  const match = registry.findProviderForModel(model);
  if (match) {
    return {
      name: `default-${match.provider.name}`,
      providers: [match.provider.name],
    };
  }

  // Last resort: try all providers
  const allProviders = Array.from(registry.getAll().keys());
  return {
    name: 'all-providers',
    providers: allProviders,
  };
}

function estimateTokensQuick(messages: ChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += 4 + Math.ceil(getMessageText(msg).length / 4);
  }
  return total + 3;
}
