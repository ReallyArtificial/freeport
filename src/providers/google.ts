import type {
  LLMProvider,
  CompletionRequest,
  CompletionResponse,
  ProviderResponse,
  StreamingProviderResponse,
} from './base.js';

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
}

interface GeminiResponse {
  candidates: Array<{
    content: { parts: Array<{ text: string }>; role: string };
    finishReason: string;
  }>;
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GoogleProvider implements LLMProvider {
  name: string;
  type = 'google';
  private apiBase: string;

  constructor(name: string, apiBase?: string) {
    this.name = name;
    this.apiBase = apiBase ?? 'https://generativelanguage.googleapis.com';
  }

  transformRequest(request: CompletionRequest): GeminiRequest {
    const contents: GeminiContent[] = [];
    let systemInstruction: { parts: Array<{ text: string }> } | undefined;

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemInstruction = { parts: [{ text: msg.content }] };
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      }
    }

    const result: GeminiRequest = { contents };
    if (systemInstruction) result.systemInstruction = systemInstruction;

    const generationConfig: GeminiRequest['generationConfig'] = {};
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.top_p !== undefined) generationConfig.topP = request.top_p;
    if (request.max_tokens !== undefined) generationConfig.maxOutputTokens = request.max_tokens;
    if (request.stop) {
      generationConfig.stopSequences = Array.isArray(request.stop) ? request.stop : [request.stop];
    }
    if (Object.keys(generationConfig).length > 0) result.generationConfig = generationConfig;

    return result;
  }

  transformResponse(body: unknown, model: string): CompletionResponse {
    const gemini = body as GeminiResponse;
    const text = gemini.candidates?.[0]?.content?.parts
      ?.map(p => p.text)
      .join('') ?? '';

    return {
      id: `chatcmpl-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: mapFinishReason(gemini.candidates?.[0]?.finishReason),
      }],
      usage: {
        prompt_tokens: gemini.usageMetadata?.promptTokenCount ?? 0,
        completion_tokens: gemini.usageMetadata?.candidatesTokenCount ?? 0,
        total_tokens: gemini.usageMetadata?.totalTokenCount ?? 0,
      },
    };
  }

  async chatCompletion(request: CompletionRequest, apiKey: string): Promise<ProviderResponse> {
    const model = request.model;
    const url = `${this.apiBase}/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const body = this.transformRequest({ ...request, stream: false });

    const start = performance.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const latencyMs = Math.round(performance.now() - start);
    const rawBody = await res.text();

    if (!res.ok) {
      throw new Error(`Google API error ${res.status}: ${rawBody}`);
    }

    const parsed = JSON.parse(rawBody);
    const response = this.transformResponse(parsed, model);

    return {
      response,
      rawBody,
      statusCode: res.status,
      latencyMs,
      provider: this.name,
    };
  }

  async chatCompletionStream(request: CompletionRequest, apiKey: string): Promise<StreamingProviderResponse> {
    const model = request.model;
    const url = `${this.apiBase}/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;
    const body = this.transformRequest(request);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Google API error ${res.status}: ${errBody}`);
    }

    if (!res.body) {
      throw new Error('No response body for streaming request');
    }

    const transformedStream = this.transformStream(res.body, model);

    return {
      stream: transformedStream,
      statusCode: res.status,
      provider: this.name,
      model,
    };
  }

  private transformStream(inputStream: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let buffer = '';
    let previousContent = ''; // Track cumulative content to emit only deltas
    const streamId = `chatcmpl-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = inputStream.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
              break;
            }

            // Decode complete chunk to avoid multibyte UTF-8 corruption
            buffer += decoder.decode(value);
            const lastNewline = buffer.lastIndexOf('\n');
            if (lastNewline === -1) continue;

            const complete = buffer.slice(0, lastNewline);
            buffer = buffer.slice(lastNewline + 1);

            const lines = complete.split('\n');
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (!data) continue;

              try {
                const event = JSON.parse(data) as GeminiResponse;
                const fullText = event.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '';
                // Gemini sends cumulative content — extract only the new delta
                const delta = fullText.startsWith(previousContent)
                  ? fullText.slice(previousContent.length)
                  : fullText;
                previousContent = fullText;

                if (delta) {
                  const chunk = {
                    id: streamId,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model,
                    choices: [{
                      index: 0,
                      delta: { content: delta },
                      finish_reason: event.candidates?.[0]?.finishReason === 'STOP' ? 'stop' : null,
                    }],
                  };
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

function mapFinishReason(reason?: string): string {
  switch (reason) {
    case 'STOP': return 'stop';
    case 'MAX_TOKENS': return 'length';
    case 'SAFETY': return 'content_filter';
    default: return 'stop';
  }
}
