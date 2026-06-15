import type {
  LLMProvider,
  CompletionRequest,
  CompletionResponse,
  ProviderResponse,
  StreamingProviderResponse,
  FinishReason,
  ChatMessage,
  ContentPart,
  ToolDef,
  ToolChoice,
  ToolCall,
} from './base.js';
import { getMessageText } from './base.js';

// ── Gemini parts / contents ───────────────────────────────────────────────

interface GeminiTextPart { text: string }
interface GeminiInlineDataPart { inline_data: { mime_type: string; data: string } }
interface GeminiFileDataPart { file_data: { mime_type: string; file_uri: string } }
interface GeminiFunctionCallPart { functionCall: { name: string; args: Record<string, unknown> } }
interface GeminiFunctionResponsePart { functionResponse: { name: string; response: Record<string, unknown> } }

type GeminiPart =
  | GeminiTextPart
  | GeminiInlineDataPart
  | GeminiFileDataPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart;

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  tools?: Array<{ functionDeclarations: GeminiFunctionDeclaration[] }>;
  toolConfig?: {
    functionCallingConfig: {
      mode: 'AUTO' | 'NONE' | 'ANY';
      allowedFunctionNames?: string[];
    };
  };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    responseMimeType?: string;
    responseSchema?: Record<string, unknown>;
  };
}

interface GeminiResponse {
  candidates: Array<{
    content: { parts: Array<Record<string, unknown>>; role: string };
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
    const systemParts: string[] = [];
    // Gemini correlates tool results by name, not id. Build a callId→name map
    // while walking assistant turns so role:'tool' messages resolve correctly.
    const callIdToName = new Map<string, string>();

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        const t = getMessageText(msg);
        if (t) systemParts.push(t);
        continue;
      }

      if (msg.role === 'tool') {
        const name = (msg.tool_call_id && callIdToName.get(msg.tool_call_id)) || msg.tool_call_id || 'tool';
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: { name, response: toFunctionResponse(getMessageText(msg)) },
          }],
        });
        continue;
      }

      const parts: GeminiPart[] = contentToParts(msg.content);

      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          callIdToName.set(tc.id, tc.function.name);
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: safeParseObject(tc.function.arguments),
            },
          });
        }
      }

      if (parts.length === 0) parts.push({ text: '' });
      contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts });
    }

    const result: GeminiRequest = { contents };
    if (systemParts.length > 0) {
      result.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] };
    }

    // Tools
    if (request.tools && request.tools.length > 0) {
      result.tools = [{ functionDeclarations: request.tools.map(toFunctionDeclaration) }];
    }

    // tool_choice → functionCallingConfig
    if (request.tool_choice !== undefined) {
      result.toolConfig = { functionCallingConfig: mapToolChoice(request.tool_choice) };
    }

    // generationConfig
    const generationConfig: NonNullable<GeminiRequest['generationConfig']> = {};
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.top_p !== undefined) generationConfig.topP = request.top_p;
    if (request.max_tokens !== undefined) generationConfig.maxOutputTokens = request.max_tokens;
    if (request.stop) {
      generationConfig.stopSequences = Array.isArray(request.stop) ? request.stop : [request.stop];
    }
    if (request.response_format) {
      if (request.response_format.type === 'json_object') {
        generationConfig.responseMimeType = 'application/json';
      } else if (request.response_format.type === 'json_schema') {
        generationConfig.responseMimeType = 'application/json';
        const schema = request.response_format.json_schema?.schema;
        if (schema) generationConfig.responseSchema = stripUnsupportedSchemaKeywords(schema);
      }
    }
    if (Object.keys(generationConfig).length > 0) result.generationConfig = generationConfig;

    return result;
  }

  transformResponse(body: unknown, model: string): CompletionResponse {
    const gemini = body as GeminiResponse;
    const parts = gemini.candidates?.[0]?.content?.parts ?? [];

    const text = parts
      .filter(p => typeof p.text === 'string')
      .map(p => p.text as string)
      .join('');

    const tool_calls: ToolCall[] = [];
    for (const p of parts) {
      const fc = p.functionCall as { name?: string; args?: Record<string, unknown> } | undefined;
      if (fc) {
        tool_calls.push({
          id: `call_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
          type: 'function',
          function: { name: fc.name ?? '', arguments: JSON.stringify(fc.args ?? {}) },
        });
      }
    }

    const message: ChatMessage = {
      role: 'assistant',
      content: tool_calls.length > 0 && !text ? null : text,
    };
    if (tool_calls.length > 0) message.tool_calls = tool_calls;

    const rawFinish = gemini.candidates?.[0]?.finishReason;
    const finish: FinishReason = tool_calls.length > 0 ? 'tool_calls' : mapFinishReason(rawFinish);

    return {
      id: `chatcmpl-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message, finish_reason: finish }],
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
    let previousContent = '';
    let nextToolIndex = 0;
    // Dedup tool calls Gemini may re-send across cumulative chunks.
    const seenToolCalls = new Set<string>();
    const streamId = `chatcmpl-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = inputStream.getReader();
        const decoder = new TextDecoder();
        const emit = (delta: unknown, finish: FinishReason = null) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            id: streamId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta, finish_reason: finish }],
          })}\n\n`));
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
              break;
            }

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

              let event: GeminiResponse;
              try {
                event = JSON.parse(data) as GeminiResponse;
              } catch {
                continue;
              }

              const parts = event.candidates?.[0]?.content?.parts ?? [];

              // Function calls arrive whole — emit one tool_call delta each.
              for (const p of parts) {
                const fc = (p as Record<string, unknown>).functionCall as
                  { name?: string; args?: Record<string, unknown> } | undefined;
                if (fc) {
                  const argsStr = JSON.stringify(fc.args ?? {});
                  const dedupKey = `${fc.name}:${argsStr}`;
                  if (seenToolCalls.has(dedupKey)) continue;
                  seenToolCalls.add(dedupKey);
                  emit({
                    tool_calls: [{
                      index: nextToolIndex++,
                      id: `call_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
                      type: 'function',
                      function: { name: fc.name ?? '', arguments: argsStr },
                    }],
                  });
                }
              }

              // Text: Gemini sends cumulative content — emit only the new delta.
              const fullText = parts
                .filter(p => typeof (p as Record<string, unknown>).text === 'string')
                .map(p => (p as Record<string, unknown>).text as string)
                .join('');
              if (fullText) {
                const delta = fullText.startsWith(previousContent)
                  ? fullText.slice(previousContent.length)
                  : fullText;
                previousContent = fullText;
                if (delta) {
                  emit(
                    { content: delta },
                    event.candidates?.[0]?.finishReason === 'STOP' ? 'stop' : null,
                  );
                }
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

// ── Helpers ───────────────────────────────────────────────────────────────

function contentToParts(content: string | ContentPart[] | null): GeminiPart[] {
  if (content == null) return [];
  if (typeof content === 'string') {
    return content ? [{ text: content }] : [];
  }
  const parts: GeminiPart[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ text: part.text });
    } else if (part.type === 'image_url') {
      const url = part.image_url.url;
      const dataUrl = parseDataUrl(url);
      if (dataUrl) {
        parts.push({ inline_data: { mime_type: dataUrl.mediaType, data: dataUrl.data } });
      } else {
        // Gemini officially wants Files-API/GCS URIs; arbitrary web URLs are
        // unreliable. We pass it through as file_data rather than fetch-inlining.
        parts.push({ file_data: { mime_type: 'image/jpeg', file_uri: url } });
      }
    }
  }
  return parts;
}

function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
  if (!m) return null;
  return { mediaType: m[1], data: m[2] };
}

function toFunctionResponse(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { result: parsed };
  } catch {
    return { result: text };
  }
}

function safeParseObject(s: string | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function toFunctionDeclaration(tool: ToolDef): GeminiFunctionDeclaration {
  const decl: GeminiFunctionDeclaration = { name: tool.function.name };
  if (tool.function.description) decl.description = tool.function.description;
  if (tool.function.parameters) {
    decl.parameters = stripUnsupportedSchemaKeywords(tool.function.parameters as Record<string, unknown>);
  }
  return decl;
}

function mapToolChoice(choice: ToolChoice): {
  mode: 'AUTO' | 'NONE' | 'ANY';
  allowedFunctionNames?: string[];
} {
  if (choice === 'auto') return { mode: 'AUTO' };
  if (choice === 'none') return { mode: 'NONE' };
  if (choice === 'required') return { mode: 'ANY' };
  if (typeof choice === 'object' && choice.type === 'function') {
    return { mode: 'ANY', allowedFunctionNames: [choice.function.name] };
  }
  return { mode: 'AUTO' };
}

/** Strip JSON-schema keywords Gemini's responseSchema/parameters rejects. */
function stripUnsupportedSchemaKeywords(schema: Record<string, unknown>): Record<string, unknown> {
  const drop = new Set(['$schema', 'additionalProperties', '$ref', '$defs', 'definitions']);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (drop.has(k)) continue;
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };
  return walk(schema) as Record<string, unknown>;
}

function mapFinishReason(reason?: string): FinishReason {
  switch (reason) {
    case 'STOP': return 'stop';
    case 'MAX_TOKENS': return 'length';
    case 'SAFETY': return 'content_filter';
    case 'RECITATION': return 'content_filter';
    default: return 'stop';
  }
}
