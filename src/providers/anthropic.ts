import type {
  LLMProvider,
  CompletionRequest,
  CompletionResponse,
  ProviderResponse,
  StreamingProviderResponse,
  ChatMessage,
} from './base.js';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop_sequences?: string[];
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text: string }>;
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicProvider implements LLMProvider {
  name: string;
  type = 'anthropic';
  private apiBase: string;

  constructor(name: string, apiBase?: string) {
    this.name = name;
    this.apiBase = apiBase ?? 'https://api.anthropic.com';
  }

  transformRequest(request: CompletionRequest): AnthropicRequest {
    // Extract system message
    let system: string | undefined;
    const messages: AnthropicMessage[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        system = msg.content;
      } else {
        messages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
      }
    }

    // Anthropic requires max_tokens
    const maxTokens = request.max_tokens ?? 4096;

    const result: AnthropicRequest = {
      model: request.model,
      messages,
      max_tokens: maxTokens,
    };

    if (system) result.system = system;
    if (request.temperature !== undefined) result.temperature = request.temperature;
    if (request.top_p !== undefined) result.top_p = request.top_p;
    if (request.stream !== undefined) result.stream = request.stream;
    if (request.stop) {
      result.stop_sequences = Array.isArray(request.stop) ? request.stop : [request.stop];
    }

    return result;
  }

  transformResponse(body: unknown, model: string): CompletionResponse {
    const anthropic = body as AnthropicResponse;
    const text = anthropic.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');

    return {
      id: `chatcmpl-${anthropic.id}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: mapStopReason(anthropic.stop_reason),
      }],
      usage: {
        prompt_tokens: anthropic.usage.input_tokens,
        completion_tokens: anthropic.usage.output_tokens,
        total_tokens: anthropic.usage.input_tokens + anthropic.usage.output_tokens,
      },
    };
  }

  async chatCompletion(request: CompletionRequest, apiKey: string): Promise<ProviderResponse> {
    const url = `${this.apiBase}/v1/messages`;
    const body = this.transformRequest({ ...request, stream: false });

    const start = performance.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const latencyMs = Math.round(performance.now() - start);
    const rawBody = await res.text();

    if (!res.ok) {
      throw new Error(`Anthropic API error ${res.status}: ${rawBody}`);
    }

    const parsed = JSON.parse(rawBody);
    const response = this.transformResponse(parsed, request.model);

    return {
      response,
      rawBody,
      statusCode: res.status,
      latencyMs,
      provider: this.name,
    };
  }

  async chatCompletionStream(request: CompletionRequest, apiKey: string): Promise<StreamingProviderResponse> {
    const url = `${this.apiBase}/v1/messages`;
    const body = this.transformRequest({ ...request, stream: true });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
    }

    if (!res.body) {
      throw new Error('No response body for streaming request');
    }

    // Transform Anthropic SSE stream to OpenAI-compatible SSE stream
    const transformedStream = this.transformStream(res.body, request.model);

    return {
      stream: transformedStream,
      statusCode: res.status,
      provider: this.name,
      model: request.model,
    };
  }

  private transformStream(inputStream: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let buffer = '';
    let messageId = '';

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = inputStream.getReader();
        // Use a separate decoder without streaming to avoid multibyte corruption
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
              break;
            }

            // Decode complete chunk and append to buffer
            buffer += decoder.decode(value);
            // Process only complete lines (ending with \n)
            const lastNewline = buffer.lastIndexOf('\n');
            if (lastNewline === -1) continue;

            const complete = buffer.slice(0, lastNewline);
            buffer = buffer.slice(lastNewline + 1);

            const lines = complete.split('\n');
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (!data || data === '[DONE]') continue;

              try {
                const event = JSON.parse(data);
                // Capture messageId BEFORE creating the chunk so it's available
                if (event.type === 'message_start') {
                  messageId = event.message?.id ?? '';
                }
                const chunk = transformAnthropicChunk(event, model, messageId);
                if (chunk) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                }
              } catch {
                // Skip malformed events
              }
            }
          }
        } catch (err) {
          controller.error(err);
        } finally {
          try { reader.cancel(); } catch { /* already released */ }
        }
      },
    });
  }
}

function mapStopReason(reason: string | null): string {
  switch (reason) {
    case 'end_turn': return 'stop';
    case 'max_tokens': return 'length';
    case 'stop_sequence': return 'stop';
    default: return 'stop';
  }
}

function transformAnthropicChunk(event: Record<string, unknown>, model: string, messageId: string) {
  const type = event.type as string;

  if (type === 'content_block_delta') {
    const delta = event.delta as { type: string; text?: string };
    if (delta.type === 'text_delta' && delta.text) {
      return {
        id: `chatcmpl-${messageId}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          delta: { content: delta.text },
          finish_reason: null,
        }],
      };
    }
  }

  if (type === 'message_delta') {
    const delta = event.delta as { stop_reason?: string };
    const usage = event.usage as { output_tokens?: number } | undefined;
    return {
      id: `chatcmpl-${messageId}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: mapStopReason(delta.stop_reason ?? null),
      }],
      usage: usage ? { completion_tokens: usage.output_tokens } : undefined,
    };
  }

  if (type === 'message_start') {
    return {
      id: `chatcmpl-${(event.message as Record<string, unknown>)?.id ?? ''}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        delta: { role: 'assistant' as const, content: '' },
        finish_reason: null,
      }],
    };
  }

  return null;
}
