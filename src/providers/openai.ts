import type {
  LLMProvider,
  CompletionRequest,
  CompletionResponse,
  ProviderResponse,
  StreamingProviderResponse,
} from './base.js';

export class OpenAIProvider implements LLMProvider {
  name: string;
  type = 'openai';
  private apiBase: string;

  constructor(name: string, apiBase?: string) {
    this.name = name;
    this.apiBase = apiBase ?? 'https://api.openai.com';
  }

  transformRequest(request: CompletionRequest): unknown {
    // OpenAI format is the canonical format, pass through
    return request;
  }

  transformResponse(body: unknown, _model: string): CompletionResponse {
    return body as CompletionResponse;
  }

  async chatCompletion(request: CompletionRequest, apiKey: string): Promise<ProviderResponse> {
    const url = `${this.apiBase}/v1/chat/completions`;
    const body = this.transformRequest({ ...request, stream: false });

    const start = performance.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const latencyMs = Math.round(performance.now() - start);
    const rawBody = await res.text();

    if (!res.ok) {
      throw new Error(`OpenAI API error ${res.status}: ${rawBody}`);
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
    const url = `${this.apiBase}/v1/chat/completions`;
    const body = this.transformRequest({ ...request, stream: true });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${errBody}`);
    }

    if (!res.body) {
      throw new Error('No response body for streaming request');
    }

    return {
      stream: res.body,
      statusCode: res.status,
      provider: this.name,
      model: request.model,
    };
  }

  async listModels(apiKey: string): Promise<string[]> {
    const res = await fetch(`${this.apiBase}/v1/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];
    const data = await res.json() as { data: Array<{ id: string }> };
    return data.data.map(m => m.id);
  }
}
