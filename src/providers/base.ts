export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[];
  [key: string]: unknown;
}

export interface CompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface CompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: CompletionChoice[];
  usage: UsageInfo;
}

export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Partial<ChatMessage>;
    finish_reason: string | null;
  }>;
  usage?: UsageInfo | null;
}

export interface ProviderResponse {
  response: CompletionResponse;
  rawBody: string;
  statusCode: number;
  latencyMs: number;
  provider: string;
}

export interface StreamingProviderResponse {
  stream: ReadableStream<Uint8Array>;
  statusCode: number;
  provider: string;
  model: string;
}

export interface LLMProvider {
  name: string;
  type: string;

  /** Send a non-streaming chat completion request */
  chatCompletion(request: CompletionRequest, apiKey: string): Promise<ProviderResponse>;

  /** Send a streaming chat completion request */
  chatCompletionStream(request: CompletionRequest, apiKey: string): Promise<StreamingProviderResponse>;

  /** List available models */
  listModels?(apiKey: string): Promise<string[]>;

  /** Transform from OpenAI format to provider format */
  transformRequest(request: CompletionRequest): unknown;

  /** Transform from provider format to OpenAI format */
  transformResponse(body: unknown, model: string): CompletionResponse;
}
