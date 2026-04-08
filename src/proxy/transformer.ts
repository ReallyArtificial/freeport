import type { CompletionRequest, ChatMessage } from '../providers/base.js';

/**
 * Normalize incoming request body to our internal CompletionRequest format.
 * Handles both /v1/chat/completions and /v1/completions formats.
 */
export function normalizeRequest(body: Record<string, unknown>): CompletionRequest {
  // Validate model field
  if (!body.model || typeof body.model !== 'string') {
    throw new Error('Missing or invalid "model" field — must be a non-empty string');
  }

  // Chat completions format (preferred)
  if (body.messages && Array.isArray(body.messages)) {
    return {
      model: body.model as string,
      messages: body.messages as ChatMessage[],
      temperature: body.temperature as number | undefined,
      max_tokens: body.max_tokens as number | undefined,
      top_p: body.top_p as number | undefined,
      stream: body.stream as boolean | undefined,
      stop: body.stop as string | string[] | undefined,
      // Pass through extra fields
      ...extractExtraFields(body),
    };
  }

  // Legacy completions format — convert to chat format
  if (body.prompt) {
    const prompt = body.prompt as string;
    return {
      model: body.model as string,
      messages: [{ role: 'user', content: prompt }],
      temperature: body.temperature as number | undefined,
      max_tokens: body.max_tokens as number | undefined,
      top_p: body.top_p as number | undefined,
      stream: body.stream as boolean | undefined,
      stop: body.stop as string | string[] | undefined,
    };
  }

  // Managed prompt mode — no messages needed, prompt resolver will fill them in
  const freeportMeta = (body.freeport ?? body.metadata) as Record<string, unknown> | undefined;
  if (freeportMeta?.prompt) {
    return {
      model: body.model as string,
      messages: [{ role: 'user', content: '' }],
      temperature: body.temperature as number | undefined,
      max_tokens: body.max_tokens as number | undefined,
      top_p: body.top_p as number | undefined,
      stream: body.stream as boolean | undefined,
      stop: body.stop as string | string[] | undefined,
    };
  }

  throw new Error('Request must include either "messages" or "prompt" field');
}

/** Extract the prompt text from messages for caching/guardrails */
export function extractPromptText(messages: ChatMessage[]): string {
  return messages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');
}

/** Extract Freeport-specific fields from the request */
export function extractFreeportMetadata(body: Record<string, unknown>): {
  projectId?: string;
  promptSlug?: string;
  promptVersion?: number;
  promptVariables?: Record<string, string>;
  abTestId?: string;
  cacheControl?: 'no-cache' | 'force-cache';
} {
  const metadata = body.metadata as Record<string, unknown> | undefined;
  const freeport = body.freeport as Record<string, unknown> | undefined;
  const source = freeport ?? metadata;

  if (!source) return {};

  return {
    projectId: source.project_id as string | undefined,
    promptSlug: source.prompt as string | undefined,
    promptVersion: source.prompt_version as number | undefined,
    promptVariables: source.variables as Record<string, string> | undefined,
    abTestId: source.ab_test as string | undefined,
    cacheControl: source.cache as 'no-cache' | 'force-cache' | undefined,
  };
}

function extractExtraFields(body: Record<string, unknown>): Record<string, unknown> {
  const known = new Set([
    'model', 'messages', 'temperature', 'max_tokens', 'top_p',
    'stream', 'stop', 'metadata', 'freeport',
  ]);

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!known.has(key)) {
      extra[key] = value;
    }
  }
  return extra;
}
