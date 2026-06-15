// ── Multimodal content parts ─────────────────────────────────────────────

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImagePart {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export type ContentPart = TextPart | ImagePart;

// ── Tools / function calling ──────────────────────────────────────────────

export interface FunctionDef {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ToolDef {
  type: 'function';
  function: FunctionDef;
}

/** Alias kept for readability — a tool definition supplied on the request. */
export type Tool = ToolDef;

export type ToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** A streaming fragment of a tool call. `arguments` is a JSON-string fragment. */
export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

// ── Response format (JSON mode) ───────────────────────────────────────────

export interface ResponseFormat {
  type: 'text' | 'json_object' | 'json_schema';
  json_schema?: {
    name?: string;
    schema?: Record<string, unknown>;
    strict?: boolean;
  };
}

// ── Messages ──────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/**
 * Flatten a message's content to a plain string for guardrails, cache hashing,
 * embeddings, logging, and token counting. Image parts collapse to a stable
 * `[image]` token so cache keys stay deterministic and don't bloat with base64.
 */
export function getMessageText(m: ChatMessage): string {
  const c = m.content;
  if (c == null) return '';
  if (typeof c === 'string') return c;
  return c.map(p => (p.type === 'text' ? p.text : '[image]')).join('');
}

// ── Requests / responses ──────────────────────────────────────────────────

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[];
  // Tools / function calling
  tools?: ToolDef[];
  tool_choice?: ToolChoice;
  // Structured output
  response_format?: ResponseFormat;
  // Sampling / misc params
  n?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  user?: string;
  parallel_tool_calls?: boolean;
  stream_options?: { include_usage?: boolean };
  [key: string]: unknown;
}

export type FinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | 'function_call'
  | null;

export interface CompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: FinishReason;
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

export interface StreamDelta {
  role?: 'assistant';
  content?: string | null;
  tool_calls?: ToolCallDelta[];
}

export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: StreamDelta;
    finish_reason: FinishReason;
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
