import type { FastifyRequest, FastifyReply } from 'fastify';
import type { FreeportConfig, FallbackChainConfig } from '../config/types.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { CompletionRequest, CompletionResponse } from '../providers/base.js';
import { normalizeRequest, extractFreeportMetadata, extractPromptText } from './transformer.js';
import { preProcess, postProcess, type PipelineContext } from './pipeline.js';
import { pipeStream } from './streaming.js';
import { executeWithFallback, executeWithFallbackStream } from '../routing/fallback.js';
import { getOrCreateBalancer } from '../routing/loadbalancer.js';
import { getActiveTests, selectVariant, recordABResult } from '../routing/ab-router.js';
import { getLogger } from '../logging/logger.js';

export function createProxyHandler(config: FreeportConfig, registry: ProviderRegistry) {
  const log = getLogger();

  return async function handleProxy(request: FastifyRequest, reply: FastifyReply) {
    const startTime = performance.now();
    const body = request.body as Record<string, unknown>;

    try {
      // Parse and normalize the request
      const completionReq = normalizeRequest(body);
      const metadata = extractFreeportMetadata(body);

      // Read freeport context from API key auth (if present)
      const freeportCtx = (request as any).freeportContext as
        { projectId?: string; apiKeyId?: string } | undefined;

      // Build pipeline context
      const context: PipelineContext = {
        request: completionReq,
        projectId: metadata.projectId || freeportCtx?.projectId,
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

        // Post-process (logging, etc.)
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

        return reply.header('X-Cache', 'HIT').header('X-Cache-Similarity', String(cached.similarity)).send(cachedResponse);
      }

      // Snapshot the resolved request for logging (after prompt resolution, guardrails, etc.)
      const resolvedRequestBody = JSON.stringify({
        model: completionReq.model,
        messages: completionReq.messages,
        ...(completionReq.temperature !== undefined && { temperature: completionReq.temperature }),
        ...(completionReq.max_tokens !== undefined && { max_tokens: completionReq.max_tokens }),
        ...(completionReq.stream && { stream: completionReq.stream }),
      });

      // Route to provider
      const isStreaming = completionReq.stream === true;

      // Find the appropriate fallback chain or direct provider
      const chain = findChain(completionReq.model, config, registry);

      if (isStreaming) {
        // Streaming path
        const streamResponse = await executeWithFallbackStream(
          completionReq, chain, registry,
        );

        const { fullContent, chunks } = await pipeStream(streamResponse, reply);
        const latencyMs = Math.round(performance.now() - startTime);

        // Post-process — stream is already sent, but we still await to ensure
        // logging, caching, and budget tracking complete before the handler exits
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

        // Record A/B test result
        if (abVariant) {
          recordABResult({
            testId: abVariant.testId,
            variantId: abVariant.id,
            latencyMs,
            cost: 0, // Will be calculated in post-process
          });
        }

        return; // Already sent via pipeStream
      }

      // Non-streaming path
      const providerResponse = await executeWithFallback(completionReq, chain, registry);
      const latencyMs = Math.round(performance.now() - startTime);
      const response = providerResponse.response;

      // Post-process
      await postProcess({
        context,
        provider: providerResponse.provider,
        model: response.model,
        responseText: response.choices[0]?.message?.content ?? '',
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        latencyMs,
        isCached: false,
        isFallback: chain.providers.length > 1,
        rawRequestBody: JSON.stringify(body),
        rawResponseBody: providerResponse.rawBody,
      });

      // Record A/B test result
      if (abVariant) {
        recordABResult({
          testId: abVariant.testId,
          variantId: abVariant.id,
          latencyMs,
          inputTokens: response.usage?.prompt_tokens,
          outputTokens: response.usage?.completion_tokens,
        });
      }

      return reply.header('X-Cache', 'MISS').send(response);
    } catch (err: unknown) {
      const latencyMs = Math.round(performance.now() - startTime);
      const error = err as Error & { statusCode?: number; code?: string };

      log.error({
        err: error.message,
        statusCode: error.statusCode,
        latencyMs,
      }, 'Proxy request failed');

      const statusCode = error.statusCode ?? 500;
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
function findChain(
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

function estimateTokensQuick(messages: Array<{ role: string; content: string }>): number {
  let total = 0;
  for (const msg of messages) {
    total += 4 + Math.ceil((msg.content?.length ?? 0) / 4);
  }
  return total + 3;
}
