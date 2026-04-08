import type { CompletionRequest } from '../providers/base.js';
import type { FreeportConfig } from '../config/types.js';
import { checkRateLimit } from '../ratelimit/limiter.js';
import { checkBudget } from '../budget/enforcer.js';
import { trackSpend } from '../budget/tracker.js';
import { runInputGuardrails, runOutputGuardrails } from '../guardrails/engine.js';
import { cacheLookup, cacheStore } from '../cache/semantic.js';
import { resolvePrompt } from '../prompts/resolver.js';
import { extractPromptText } from './transformer.js';
import { logRequest } from '../logging/request-log.js';
import { getLogger } from '../logging/logger.js';
import type { CacheHit } from '../cache/semantic.js';

export interface PipelineContext {
  request: CompletionRequest;
  projectId?: string;
  apiKeyId?: string;
  promptSlug?: string;
  promptVersion?: number;
  promptVariables?: Record<string, string>;
  cacheControl?: 'no-cache' | 'force-cache';
  abTestId?: string;
  config: FreeportConfig;
}

export interface PreProcessResult {
  request: CompletionRequest;
  cacheHit: CacheHit | null;
  guardrailResults?: unknown;
}

export interface PostProcessInput {
  context: PipelineContext;
  provider: string;
  model: string;
  responseText: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  isCached: boolean;
  isFallback: boolean;
  rawRequestBody?: string;
  rawResponseBody?: string;
}

/**
 * Pre-processing pipeline: auth -> rate limit -> budget -> prompt resolve ->
 * input guardrails -> cache lookup
 */
export async function preProcess(context: PipelineContext): Promise<PreProcessResult> {
  const { config, request } = context;
  const log = getLogger();

  // 1. Rate limit check
  if (config.rateLimit?.enabled) {
    const key = context.apiKeyId ?? context.projectId ?? 'global';
    checkRateLimit(key, config.rateLimit.requestsPerMinute ?? 60);
  }

  // 2. Budget check
  if (context.projectId && config.budget) {
    checkBudget(context.projectId, config.budget.enforcementMode);
  }

  // 3. Prompt resolution (if using managed prompt)
  if (context.promptSlug) {
    try {
      const resolved = resolvePrompt(
        context.promptSlug,
        context.promptVariables,
        context.promptVersion,
      );

      // Merge resolved prompt into the request
      if (resolved.systemPrompt) {
        request.messages = [
          { role: 'system', content: resolved.systemPrompt },
          ...request.messages.filter(m => m.role !== 'system'),
        ];
      }

      // Replace the user message content with resolved prompt if it's a template
      const lastUserMsg = [...request.messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg && resolved.content) {
        lastUserMsg.content = resolved.content;
      }

      // Apply prompt-level model/temperature overrides
      if (resolved.model) request.model = resolved.model;
      if (resolved.temperature !== undefined) request.temperature = resolved.temperature;
      if (resolved.maxTokens !== undefined) request.max_tokens = resolved.maxTokens;

      log.debug({
        prompt: context.promptSlug,
        version: resolved.version,
      }, 'Prompt resolved');
    } catch (err) {
      // If the user explicitly asked for a managed prompt, fail loudly
      throw Object.assign(
        new Error(`Prompt resolution failed for "${context.promptSlug}": ${(err as Error).message}`),
        { statusCode: 400, code: 'PROMPT_RESOLUTION_FAILED' },
      );
    }
  }

  // 4. Input guardrails
  if (config.guardrails?.enabled) {
    const promptText = extractPromptText(request.messages);
    const guardrailResult = runInputGuardrails(promptText);

    if (!guardrailResult.passed) {
      throw Object.assign(
        new Error(guardrailResult.results.find(r => !r.passed)?.message ?? 'Input guardrail failed'),
        { statusCode: 400, code: 'GUARDRAIL_VIOLATION' },
      );
    }
  }

  // 5. Cache lookup
  let cacheHit: CacheHit | null = null;
  if (config.cache?.enabled && context.cacheControl !== 'no-cache' && !request.stream) {
    const promptText = extractPromptText(request.messages);
    cacheHit = await cacheLookup(request.model, promptText, config.cache);
  }

  return { request, cacheHit };
}

/**
 * Post-processing pipeline: output guardrails -> cost tracking -> budget update ->
 * cache store -> request log
 */
export async function postProcess(input: PostProcessInput): Promise<void> {
  const { context, provider, model } = input;
  const config = context.config;
  const log = getLogger();

  // 1. Output guardrails
  if (config.guardrails?.enabled && input.responseText) {
    const guardrailResult = runOutputGuardrails(input.responseText);
    if (!guardrailResult.passed) {
      log.warn({
        guardrails: guardrailResult.results.filter(r => !r.passed),
      }, 'Output guardrail triggered');
    }
  }

  // 2. Track cost
  const cost = trackSpend({
    projectId: context.projectId,
    model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
  });

  // 3. Cache store
  if (config.cache?.enabled && !input.isCached && input.responseText &&
      context.cacheControl !== 'no-cache') {
    const promptText = extractPromptText(context.request.messages);
    await cacheStore(model, promptText, input.responseText, input.inputTokens, input.outputTokens, config.cache);
  }

  // 4. Log request
  if (config.logging?.requestLogging !== false) {
    try {
      logRequest({
        projectId: context.projectId,
        apiKeyId: context.apiKeyId,
        provider,
        model,
        requestBody: input.rawRequestBody,
        responseBody: input.rawResponseBody,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        totalTokens: input.inputTokens + input.outputTokens,
        cost,
        latencyMs: input.latencyMs,
        statusCode: 200,
        isCached: input.isCached,
        isFallback: input.isFallback,
      });
    } catch (err) {
      log.error({ err }, 'Failed to log request');
    }
  }
}
