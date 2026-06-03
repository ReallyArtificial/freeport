# Provider Interface Specification

This document defines the interface that all LLM provider implementations in Freeport must follow.

## Overview

Freeport uses a **unified provider abstraction** that allows routing requests to OpenAI, Anthropic, Google Gemini, and other LLM providers through a single OpenAI-compatible API.

All provider implementations must implement the `LLMProvider` interface defined in `src/providers/base.ts`.

---

## Core Interface

```typescript
export interface LLMProvider {
  name: string;                    // Provider instance name (e.g., "openai-prod")
  type: string;                    // Provider type (e.g., "openai", "anthropic", "google")

  /** Send a non-streaming chat completion request */
  chatCompletion(request: CompletionRequest, apiKey: string): Promise<ProviderResponse>;

  /** Send a streaming chat completion request */
  chatCompletionStream(request: CompletionRequest, apiKey: string): Promise<StreamingProviderResponse>;

  /** Transform from OpenAI format to provider-specific format */
  transformRequest(request: CompletionRequest): unknown;

  /** Transform from provider-specific format to OpenAI format */
  transformResponse(body: unknown, model: string): CompletionResponse;

  /** List available models (optional) */
  listModels?(apiKey: string): Promise<string[]>;
}
```

---

## Data Types

### CompletionRequest (OpenAI Format - Input)

```typescript
export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[];
  [key: string]: unknown;          // Allow provider-specific extensions
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
```

### CompletionResponse (OpenAI Format - Output)

```typescript
export interface CompletionResponse {
  id: string;
  object: string;                   // e.g., "chat.completion"
  created: number;                  // Unix timestamp
  model: string;
  choices: CompletionChoice[];
  usage: UsageInfo;
}

export interface CompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;     // "stop", "length", "content_filter", etc.
}

export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
```

### ProviderResponse (Non-Streaming)

```typescript
export interface ProviderResponse {
  response: CompletionResponse;     // Normalized OpenAI format
  rawBody: string;                  // Original provider response
  statusCode: number;               // HTTP status code
  latencyMs: number;                // Request duration
  provider: string;                 // Provider name for logging/routing
}
```

### StreamingProviderResponse

```typescript
export interface StreamingProviderResponse {
  stream: ReadableStream<Uint8Array>;  // Server-sent events stream
  statusCode: number;
  provider: string;
  model: string;
}

export interface StreamChunk {
  id: string;
  object: string;                   // "chat.completion.chunk"
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Partial<ChatMessage>;    // Incremental content
    finish_reason: string | null;
  }>;
  usage?: UsageInfo | null;         // Final chunk only
}
```

---

## Implementation Guide

### 1. Create a New Provider Class

Create a file in `src/providers/<name>.ts`:

```typescript
import type {
  LLMProvider,
  CompletionRequest,
  CompletionResponse,
  ProviderResponse,
  StreamingProviderResponse,
} from './base.js';

export class MyProviderProvider implements LLMProvider {
  name: string;
  type = 'myprovider';
  private apiBase: string;

  constructor(name: string, apiBase?: string) {
    this.name = name;
    this.apiBase = apiBase ?? 'https://api.myprovider.com';
  }

  // Implement required methods below
}
```

### 2. Implement Request Transformation

Convert OpenAI format → provider-specific format:

```typescript
transformRequest(request: CompletionRequest): MyProviderRequest {
  return {
    model: request.model,
    prompt: this.messagesToPrompt(request.messages),  // Provider-specific
    temperature: request.temperature,
    max_tokens: request.max_tokens ?? 2048,
    // ...map other fields
  };
}
```

**Common transformations:**
- **System messages**: Some providers (Anthropic) separate `system` from `messages`
- **Required fields**: Some providers require `max_tokens` (default if missing)
- **Field naming**: OpenAI uses `max_tokens`, some use `maxTokens` or `max_output_tokens`
- **Stop sequences**: OpenAI allows `string | string[]`, normalize to array

### 3. Implement Response Transformation

Convert provider-specific format → OpenAI format:

```typescript
transformResponse(body: unknown, model: string): CompletionResponse {
  const providerResponse = body as MyProviderResponse;
  
  return {
    id: providerResponse.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: providerResponse.output.text,  // Provider-specific field
      },
      finish_reason: this.mapFinishReason(providerResponse.stop_reason),
    }],
    usage: {
      prompt_tokens: providerResponse.usage.input_tokens,
      completion_tokens: providerResponse.usage.output_tokens,
      total_tokens: providerResponse.usage.input_tokens + providerResponse.usage.output_tokens,
    },
  };
}

private mapFinishReason(providerReason: string): string {
  // Map provider-specific finish reasons to OpenAI standard
  const map: Record<string, string> = {
    'end_turn': 'stop',
    'max_tokens': 'length',
    // ...
  };
  return map[providerReason] ?? providerReason;
}
```

### 4. Implement Non-Streaming Chat Completion

```typescript
async chatCompletion(request: CompletionRequest, apiKey: string): Promise<ProviderResponse> {
  const startTime = Date.now();
  const providerRequest = this.transformRequest(request);

  const response = await fetch(`${this.apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      // Provider-specific headers (e.g., Anthropic uses x-api-key, anthropic-version)
    },
    body: JSON.stringify(providerRequest),
  });

  const rawBody = await response.text();
  const body = JSON.parse(rawBody);

  if (!response.ok) {
    throw new Error(`Provider API error: ${response.status} ${rawBody}`);
  }

  const latencyMs = Date.now() - startTime;

  return {
    response: this.transformResponse(body, request.model),
    rawBody,
    statusCode: response.status,
    latencyMs,
    provider: this.name,
  };
}
```

### 5. Implement Streaming Chat Completion

```typescript
async chatCompletionStream(request: CompletionRequest, apiKey: string): Promise<StreamingProviderResponse> {
  const providerRequest = { ...this.transformRequest(request), stream: true };

  const response = await fetch(`${this.apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(providerRequest),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Provider stream error: ${response.status} ${errorText}`);
  }

  // Transform provider SSE stream → OpenAI SSE format
  const transformedStream = response.body!
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(this.createSSETransformer(request.model));

  return {
    stream: transformedStream.pipeThrough(new TextEncoderStream()),
    statusCode: response.status,
    provider: this.name,
    model: request.model,
  };
}

private createSSETransformer(model: string): TransformStream<string, string> {
  return new TransformStream({
    transform(chunk, controller) {
      // Parse provider SSE events → transform to OpenAI format
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            controller.enqueue('data: [DONE]\n\n');
            continue;
          }
          const providerChunk = JSON.parse(data);
          const openaiChunk = transformStreamChunk(providerChunk, model);
          controller.enqueue(`data: ${JSON.stringify(openaiChunk)}\n\n`);
        }
      }
    },
  });
}
```

### 6. Register the Provider

Add your provider to `src/providers/registry.ts`:

```typescript
import { MyProviderProvider } from './myprovider.js';

const PROVIDER_CLASSES = {
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  google: GoogleProvider,
  myprovider: MyProviderProvider,  // Add this
};
```

---

## Testing

Create provider tests in `tests/providers.test.ts`:

```typescript
describe('MyProviderProvider', () => {
  const provider = new MyProviderProvider('test-provider');

  test('transformRequest converts OpenAI → MyProvider format', () => {
    const request: CompletionRequest = {
      model: 'my-model',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.7,
      max_tokens: 100,
    };

    const result = provider.transformRequest(request);
    expect(result).toMatchObject({
      model: 'my-model',
      // ...provider-specific fields
    });
  });

  test('transformResponse converts MyProvider → OpenAI format', () => {
    const providerResponse = { /* mock provider response */ };
    const result = provider.transformResponse(providerResponse, 'my-model');

    expect(result).toMatchObject({
      id: expect.any(String),
      object: 'chat.completion',
      model: 'my-model',
      choices: expect.arrayContaining([
        expect.objectContaining({
          message: { role: 'assistant', content: expect.any(String) },
          finish_reason: expect.any(String),
        }),
      ]),
      usage: expect.objectContaining({
        prompt_tokens: expect.any(Number),
        completion_tokens: expect.any(Number),
        total_tokens: expect.any(Number),
      }),
    });
  });
});
```

---

## Best Practices

1. **Error Handling**: Throw descriptive errors with status codes and provider-specific details
2. **Logging**: Log provider name and latency for debugging fallback chains
3. **Type Safety**: Use TypeScript interfaces for provider-specific request/response types
4. **Field Defaults**: Set reasonable defaults for required fields (e.g., `max_tokens: 2048`)
5. **Streaming**: Test both streaming and non-streaming paths separately
6. **Token Counting**: Always populate `usage` (estimate if provider doesn't return it)
7. **Finish Reasons**: Map provider-specific reasons to OpenAI standard (`stop`, `length`, `content_filter`, `null`)

---

## Example Providers

Reference implementations:

- **OpenAI** (`src/providers/openai.ts`) — Simplest (pass-through)
- **Anthropic** (`src/providers/anthropic.ts`) — Separates system messages
- **Google** (`src/providers/google.ts`) — Complex format transformation

---

## Configuration

Once implemented, users can configure your provider via:

### Admin UI
`http://localhost:4000/ui/` → Providers → Add Provider → Select "myprovider"

### Environment Variables
```bash
FREEPORT_MYPROVIDER_API_KEY=xxx npm run dev
```

### YAML Config
```yaml
providers:
  - name: my-provider-prod
    type: myprovider
    keys:
      - key: "${MYPROVIDER_API_KEY}"
```

---

## Questions?

Open an issue at [github.com/reallyartificial/freeport/issues](https://github.com/reallyartificial/freeport/issues) or see the [Contributing Guide](../CONTRIBUTING.md).
