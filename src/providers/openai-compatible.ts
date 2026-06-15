import type {
  LLMProvider,
  CompletionRequest,
  CompletionResponse,
  ProviderResponse,
  StreamingProviderResponse,
} from './base.js';
import type { AuthStyle } from '../config/types.js';

export interface OpenAICompatibleConfig {
  name: string;
  apiBase: string;
  authStyle?: AuthStyle;
  authHeaderName?: string;
  authQueryName?: string;
  headers?: Record<string, string>;
  chatPath?: string;
  modelsPath?: string;
}

/**
 * A single config-driven provider that speaks the OpenAI wire format against any
 * compatible backend: Azure OpenAI, Groq, Together, OpenRouter, Mistral, DeepSeek,
 * Fireworks, Ollama, vLLM, etc. Request/response transforms are identity (the
 * canonical format IS the OpenAI format), so tools/vision/response_format pass
 * through with full fidelity. Only auth and URL building vary.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  name: string;
  type = 'openai-compatible';

  private apiBase: string;
  private authStyle: AuthStyle;
  private authHeaderName: string;
  private authQueryName: string;
  private staticHeaders: Record<string, string>;
  private chatPath: string;
  private modelsPath: string;

  constructor(config: OpenAICompatibleConfig) {
    this.name = config.name;
    this.apiBase = config.apiBase.replace(/\/$/, '');
    this.authStyle = config.authStyle ?? 'bearer';
    this.authHeaderName = config.authHeaderName ?? 'Authorization';
    this.authQueryName = config.authQueryName ?? 'api-key';
    this.staticHeaders = config.headers ?? {};
    this.chatPath = config.chatPath ?? '/v1/chat/completions';
    this.modelsPath = config.modelsPath ?? '/v1/models';
  }

  /** Build request headers based on the configured auth style + static headers. */
  buildHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.staticHeaders,
    };
    switch (this.authStyle) {
      case 'bearer':
        headers['Authorization'] = `Bearer ${apiKey}`;
        break;
      case 'header':
        headers[this.authHeaderName] = apiKey;
        break;
      case 'query':
      case 'none':
        // no header-based auth
        break;
    }
    return headers;
  }

  /** Build the chat URL, appending query auth when configured. */
  private buildUrl(path: string, apiKey: string): string {
    let url = `${this.apiBase}${path}`;
    if (this.authStyle === 'query') {
      const sep = url.includes('?') ? '&' : '?';
      url += `${sep}${encodeURIComponent(this.authQueryName)}=${encodeURIComponent(apiKey)}`;
    }
    return url;
  }

  transformRequest(request: CompletionRequest): unknown {
    // OpenAI format is the canonical format — pass through.
    return request;
  }

  transformResponse(body: unknown, _model: string): CompletionResponse {
    return body as CompletionResponse;
  }

  async chatCompletion(request: CompletionRequest, apiKey: string): Promise<ProviderResponse> {
    const url = this.buildUrl(this.chatPath, apiKey);
    const body = this.transformRequest({ ...request, stream: false });

    const start = performance.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(apiKey),
      body: JSON.stringify(body),
    });

    const latencyMs = Math.round(performance.now() - start);
    const rawBody = await res.text();

    if (!res.ok) {
      throw new Error(`${this.name} API error ${res.status}: ${rawBody}`);
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
    const url = this.buildUrl(this.chatPath, apiKey);
    const body = this.transformRequest({ ...request, stream: true });

    const res = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(apiKey),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`${this.name} API error ${res.status}: ${errBody}`);
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
    const res = await fetch(this.buildUrl(this.modelsPath, apiKey), {
      headers: this.buildHeaders(apiKey),
    });
    if (!res.ok) return [];
    const data = await res.json() as { data?: Array<{ id: string }> };
    return data.data?.map(m => m.id) ?? [];
  }
}
