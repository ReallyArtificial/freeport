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

// ── Anthropic content blocks ──────────────────────────────────────────────

interface AnthropicTextBlock { type: 'text'; text: string }
interface AnthropicImageBlock {
  type: 'image';
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string };
}
interface AnthropicToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown }
interface AnthropicToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string }

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

type AnthropicToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string };

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop_sequences?: string[];
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  model: string;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

const JSON_OUTPUT_TOOL = 'json_output';

export class AnthropicProvider implements LLMProvider {
  name: string;
  type = 'anthropic';
  private apiBase: string;

  constructor(name: string, apiBase?: string) {
    this.name = name;
    this.apiBase = apiBase ?? 'https://api.anthropic.com';
  }

  transformRequest(request: CompletionRequest): AnthropicRequest {
    const systemParts: string[] = [];
    const messages: AnthropicMessage[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        const t = getMessageText(msg);
        if (t) systemParts.push(t);
        continue;
      }

      if (msg.role === 'tool') {
        // Fold into a user message with a tool_result block. Coalesce with the
        // preceding user message if it's also tool_result-only.
        const block: AnthropicToolResultBlock = {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id ?? '',
          content: getMessageText(msg),
        };
        const prev = messages[messages.length - 1];
        if (prev && prev.role === 'user' && prev.content.every(b => b.type === 'tool_result')) {
          prev.content.push(block);
        } else {
          messages.push({ role: 'user', content: [block] });
        }
        continue;
      }

      // user | assistant
      const blocks: AnthropicContentBlock[] = [];

      // Content (string or parts)
      blocks.push(...contentToBlocks(msg.content));

      // Assistant tool calls → tool_use blocks
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: safeParseJson(tc.function.arguments),
          });
        }
      }

      if (blocks.length === 0) blocks.push({ type: 'text', text: '' });
      messages.push({ role: msg.role, content: blocks });
    }

    const result: AnthropicRequest = {
      model: request.model,
      messages,
      max_tokens: request.max_tokens ?? 4096,
    };

    if (systemParts.length > 0) result.system = systemParts.join('\n\n');
    // Anthropic temperature is in [0, 1].
    if (request.temperature !== undefined) result.temperature = Math.min(request.temperature, 1);
    if (request.top_p !== undefined) result.top_p = request.top_p;
    if (request.stream !== undefined) result.stream = request.stream;
    if (request.stop) {
      result.stop_sequences = Array.isArray(request.stop) ? request.stop : [request.stop];
    }

    // Tools
    if (request.tools && request.tools.length > 0) {
      result.tools = request.tools.map(toAnthropicTool);
    }

    // tool_choice
    if (request.tool_choice !== undefined) {
      const tc = mapToolChoice(request.tool_choice);
      if (tc === 'drop_tools') {
        delete result.tools;
      } else if (tc) {
        result.tool_choice = tc;
      }
    }

    // response_format → forced tool injection (LiteLLM-equivalent JSON strategy)
    if (request.response_format &&
        (request.response_format.type === 'json_object' || request.response_format.type === 'json_schema')) {
      const schema = request.response_format.json_schema?.schema ?? { type: 'object' };
      result.tools = [
        ...(result.tools ?? []),
        {
          name: JSON_OUTPUT_TOOL,
          description: 'Respond with structured JSON output.',
          input_schema: schema,
        },
      ];
      result.tool_choice = { type: 'tool', name: JSON_OUTPUT_TOOL };
    }

    return result;
  }

  transformResponse(body: unknown, model: string): CompletionResponse {
    const anthropic = body as AnthropicResponse;
    const blocks = anthropic.content ?? [];

    // response_format unwrap: if the only tool_use is json_output, surface its
    // input as the message content (a JSON string) and report a normal stop.
    const jsonOut = blocks.find(b => b.type === 'tool_use' && b.name === JSON_OUTPUT_TOOL);
    if (jsonOut) {
      return {
        id: `chatcmpl-${anthropic.id}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: JSON.stringify(jsonOut.input ?? {}) },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: anthropic.usage.input_tokens,
          completion_tokens: anthropic.usage.output_tokens,
          total_tokens: anthropic.usage.input_tokens + anthropic.usage.output_tokens,
        },
      };
    }

    const text = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('');
    const toolUses = blocks.filter(b => b.type === 'tool_use');
    const tool_calls: ToolCall[] = toolUses.map(b => ({
      id: b.id ?? '',
      type: 'function' as const,
      function: { name: b.name ?? '', arguments: JSON.stringify(b.input ?? {}) },
    }));

    const message: ChatMessage = {
      role: 'assistant',
      content: tool_calls.length > 0 && !text ? null : text,
    };
    if (tool_calls.length > 0) message.tool_calls = tool_calls;

    return {
      id: `chatcmpl-${anthropic.id}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message,
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
    // Map Anthropic content-block index → OpenAI tool-call index (0-based among
    // tool calls only). Non-tool blocks are not tracked here.
    const blockToToolIndex = new Map<number, number>();
    let nextToolIndex = 0;

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = inputStream.getReader();
        const decoder = new TextDecoder();
        const emit = (chunk: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        };
        const baseChunk = (delta: unknown, finish: FinishReason = null, usage?: unknown) => ({
          id: `chatcmpl-${messageId}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta, finish_reason: finish }],
          ...(usage ? { usage } : {}),
        });

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
              if (!data || data === '[DONE]') continue;

              let event: Record<string, unknown>;
              try {
                event = JSON.parse(data);
              } catch {
                continue;
              }
              const type = event.type as string;

              if (type === 'message_start') {
                const msg = event.message as Record<string, unknown> | undefined;
                messageId = (msg?.id as string) ?? '';
                emit(baseChunk({ role: 'assistant', content: '' }));
                continue;
              }

              if (type === 'content_block_start') {
                const idx = event.index as number;
                const block = event.content_block as Record<string, unknown> | undefined;
                if (block?.type === 'tool_use') {
                  const toolIndex = nextToolIndex++;
                  blockToToolIndex.set(idx, toolIndex);
                  emit(baseChunk({
                    tool_calls: [{
                      index: toolIndex,
                      id: block.id as string,
                      type: 'function',
                      function: { name: block.name as string, arguments: '' },
                    }],
                  }));
                }
                continue;
              }

              if (type === 'content_block_delta') {
                const idx = event.index as number;
                const delta = event.delta as { type: string; text?: string; partial_json?: string };
                if (delta.type === 'text_delta' && delta.text) {
                  emit(baseChunk({ content: delta.text }));
                } else if (delta.type === 'input_json_delta' && delta.partial_json !== undefined) {
                  const toolIndex = blockToToolIndex.get(idx);
                  if (toolIndex !== undefined) {
                    emit(baseChunk({
                      tool_calls: [{
                        index: toolIndex,
                        // Forward the JSON fragment verbatim — never parse mid-stream.
                        function: { arguments: delta.partial_json },
                      }],
                    }));
                  }
                }
                continue;
              }

              if (type === 'message_delta') {
                const delta = event.delta as { stop_reason?: string };
                const usage = event.usage as { output_tokens?: number } | undefined;
                emit(baseChunk(
                  {},
                  mapStopReason(delta.stop_reason ?? null),
                  usage ? { completion_tokens: usage.output_tokens } : undefined,
                ));
                continue;
              }
              // ping, content_block_stop, message_stop → ignored
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

function contentToBlocks(content: string | ContentPart[] | null): AnthropicContentBlock[] {
  if (content == null) return [];
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : [];
  }
  const blocks: AnthropicContentBlock[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'image_url') {
      const url = part.image_url.url;
      const dataUrl = parseDataUrl(url);
      if (dataUrl) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: dataUrl.mediaType, data: dataUrl.data },
        });
      } else {
        blocks.push({ type: 'image', source: { type: 'url', url } });
      }
    }
  }
  return blocks;
}

function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
  if (!m) return null;
  return { mediaType: m[1], data: m[2] };
}

function safeParseJson(s: string | undefined): unknown {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function toAnthropicTool(tool: ToolDef): AnthropicTool {
  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: (tool.function.parameters as Record<string, unknown>) ?? { type: 'object' },
  };
}

/** Returns an Anthropic tool_choice, or 'drop_tools' (for 'none'), or null. */
function mapToolChoice(choice: ToolChoice): AnthropicToolChoice | 'drop_tools' | null {
  if (choice === 'auto') return { type: 'auto' };
  if (choice === 'none') return 'drop_tools';
  if (choice === 'required') return { type: 'any' };
  if (typeof choice === 'object' && choice.type === 'function') {
    return { type: 'tool', name: choice.function.name };
  }
  return null;
}

function mapStopReason(reason: string | null): FinishReason {
  switch (reason) {
    case 'end_turn': return 'stop';
    case 'max_tokens': return 'length';
    case 'stop_sequence': return 'stop';
    case 'tool_use': return 'tool_calls';
    default: return 'stop';
  }
}
