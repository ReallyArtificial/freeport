import type { FastifyRequest, FastifyReply } from 'fastify';
import type { FreeportConfig } from '../config/types.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type {
  ChatMessage,
  ContentPart,
  CompletionResponse,
  FinishReason,
  ToolCall,
  ToolDef,
  ToolChoice,
} from '../providers/base.js';
import { runCompletion } from './handler.js';
import { getLogger } from '../logging/logger.js';
import { incGauge, decGauge } from '../observability/metrics.js';

// ── Anthropic Messages request shape (subset we accept) ────────────────────

interface AnthropicTextBlock { type: 'text'; text: string }
interface AnthropicImageBlock {
  type: 'image';
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string };
}
interface AnthropicToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown }
interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: unknown;
  is_error?: boolean;
}
type AnthropicInBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

interface AnthropicInMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicInBlock[];
}

interface AnthropicInTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

interface AnthropicMessagesRequest {
  model: string;
  messages: AnthropicInMessage[];
  system?: string | Array<{ type: string; text?: string }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: AnthropicInTool[];
  tool_choice?:
    | { type: 'auto' }
    | { type: 'any' }
    | { type: 'tool'; name: string }
    | { type: 'none' };
}

/**
 * Translate an Anthropic Messages request into an OpenAI-shaped body that the
 * existing proxy pipeline (`runCompletion` → `normalizeRequest`) understands.
 */
export function normalizeAnthropicRequest(body: AnthropicMessagesRequest): Record<string, unknown> {
  const messages: ChatMessage[] = [];

  // System → leading system message (string or block array).
  const systemText = systemToText(body.system);
  if (systemText) messages.push({ role: 'system', content: systemText });

  for (const msg of body.messages ?? []) {
    if (typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content });
      continue;
    }

    // A single Anthropic message may carry tool_result blocks (→ tool messages),
    // text/image blocks (→ content parts), and tool_use blocks (→ tool_calls).
    const parts: ContentPart[] = [];
    const toolCalls: ToolCall[] = [];
    const toolResults: Array<{ tool_call_id: string; content: string }> = [];

    for (const block of msg.content) {
      if (block.type === 'text') {
        parts.push({ type: 'text', text: block.text });
      } else if (block.type === 'image') {
        const url = imageBlockToUrl(block);
        if (url) parts.push({ type: 'image_url', image_url: { url } });
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        });
      } else if (block.type === 'tool_result') {
        toolResults.push({
          tool_call_id: block.tool_use_id,
          content: toolResultText(block.content),
        });
      }
    }

    // tool_result blocks become standalone `tool` messages (OpenAI shape).
    for (const tr of toolResults) {
      messages.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: tr.content });
    }

    // The remaining text/image/tool_use becomes one message for this role.
    if (parts.length > 0 || toolCalls.length > 0) {
      const m: ChatMessage = {
        role: msg.role,
        content: parts.length > 0 ? parts : (toolCalls.length > 0 ? null : ''),
      };
      if (toolCalls.length > 0) m.tool_calls = toolCalls;
      messages.push(m);
    }
  }

  const out: Record<string, unknown> = {
    model: body.model,
    messages,
    max_tokens: body.max_tokens,
  };
  if (body.temperature !== undefined) out.temperature = body.temperature;
  if (body.top_p !== undefined) out.top_p = body.top_p;
  if (body.stop_sequences) out.stop = body.stop_sequences;
  if (body.stream !== undefined) out.stream = body.stream;

  // tools → OpenAI function tools
  if (body.tools && body.tools.length > 0) {
    out.tools = body.tools.map((t): ToolDef => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema ?? { type: 'object' },
      },
    }));
  }

  // tool_choice mapping
  if (body.tool_choice) {
    const tc = body.tool_choice;
    let mapped: ToolChoice | undefined;
    if (tc.type === 'auto') mapped = 'auto';
    else if (tc.type === 'any') mapped = 'required';
    else if (tc.type === 'none') mapped = 'none';
    else if (tc.type === 'tool') mapped = { type: 'function', function: { name: tc.name } };
    if (mapped !== undefined) out.tool_choice = mapped;
  }

  return out;
}

/**
 * Serialize a canonical (OpenAI-shaped) CompletionResponse into an Anthropic
 * Messages response.
 */
export function serializeAnthropicResponse(response: CompletionResponse): Record<string, unknown> {
  const choice = response.choices[0];
  const msg = choice?.message;
  const content: Array<Record<string, unknown>> = [];

  const text = msg ? messageText(msg) : '';
  if (text) content.push({ type: 'text', text });

  if (msg?.tool_calls) {
    for (const tc of msg.tool_calls) {
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: safeParseJson(tc.function.arguments),
      });
    }
  }

  // Anthropic requires at least one content block.
  if (content.length === 0) content.push({ type: 'text', text: '' });

  return {
    id: response.id ? `msg_${response.id.replace(/^chatcmpl-?/, '')}` : `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: response.model,
    content,
    stop_reason: mapFinishReason(choice?.finish_reason ?? 'stop'),
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * Stateful re-serializer: OpenAI-format SSE chunks → Anthropic named-event SSE.
 * The upstream is always OpenAI-shaped (every provider transforms to it), so this
 * is provider-agnostic.
 */
export function anthropicStream(inputStream: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let buffer = '';

  // Streaming state
  const messageId = `msg_${Math.random().toString(36).slice(2, 14)}`;
  let started = false;
  let textBlockOpen = false;
  let textBlockIndex = -1;
  let nextBlockIndex = 0;
  let outputTokens = 0;
  let finalStopReason = 'end_turn';
  // OpenAI tool-call index → { anthropicBlockIndex } (block opened lazily on first delta)
  const toolBlocks = new Map<number, { blockIndex: number; opened: boolean }>();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = inputStream.getReader();
      const decoder = new TextDecoder();

      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const ensureStarted = () => {
        if (started) return;
        started = true;
        send('message_start', {
          type: 'message_start',
          message: {
            id: messageId,
            type: 'message',
            role: 'assistant',
            model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        });
      };

      const openTextBlock = () => {
        if (textBlockOpen) return;
        textBlockIndex = nextBlockIndex++;
        textBlockOpen = true;
        send('content_block_start', {
          type: 'content_block_start',
          index: textBlockIndex,
          content_block: { type: 'text', text: '' },
        });
      };

      const closeTextBlock = () => {
        if (!textBlockOpen) return;
        send('content_block_stop', { type: 'content_block_stop', index: textBlockIndex });
        textBlockOpen = false;
      };

      const handleChunk = (parsed: Record<string, unknown>) => {
        ensureStarted();
        const choice = (parsed.choices as Array<Record<string, unknown>> | undefined)?.[0];
        if (!choice) return;

        const delta = choice.delta as
          | { content?: string | null; tool_calls?: Array<Record<string, unknown>> }
          | undefined;

        // Text delta
        if (delta?.content) {
          // If we were streaming tool calls, text after them still opens a text block.
          openTextBlock();
          send('content_block_delta', {
            type: 'content_block_delta',
            index: textBlockIndex,
            delta: { type: 'text_delta', text: delta.content },
          });
        }

        // Tool-call deltas
        if (delta?.tool_calls) {
          // Close the text block before emitting tool_use blocks.
          closeTextBlock();
          for (const tcDelta of delta.tool_calls) {
            const idx = (tcDelta.index as number) ?? 0;
            let state = toolBlocks.get(idx);
            const fn = tcDelta.function as { name?: string; arguments?: string } | undefined;
            if (!state) {
              state = { blockIndex: nextBlockIndex++, opened: false };
              toolBlocks.set(idx, state);
            }
            if (!state.opened) {
              state.opened = true;
              send('content_block_start', {
                type: 'content_block_start',
                index: state.blockIndex,
                content_block: {
                  type: 'tool_use',
                  id: (tcDelta.id as string) ?? `toolu_${idx}`,
                  name: fn?.name ?? '',
                  input: {},
                },
              });
            }
            if (fn?.arguments) {
              // Forward the JSON fragment verbatim — never parse mid-stream.
              send('content_block_delta', {
                type: 'content_block_delta',
                index: state.blockIndex,
                delta: { type: 'input_json_delta', partial_json: fn.arguments },
              });
            }
          }
        }

        // Finish reason
        const fr = choice.finish_reason as FinishReason | undefined;
        if (fr) finalStopReason = mapFinishReason(fr);

        // Usage (if upstream forwarded it)
        const usage = parsed.usage as { completion_tokens?: number } | undefined;
        if (usage?.completion_tokens !== undefined) outputTokens = usage.completion_tokens;
      };

      const finish = () => {
        // Close any open blocks in order: text first, then tool blocks.
        closeTextBlock();
        for (const state of toolBlocks.values()) {
          if (state.opened) {
            send('content_block_stop', { type: 'content_block_stop', index: state.blockIndex });
          }
        }
        send('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: finalStopReason, stop_sequence: null },
          usage: { output_tokens: outputTokens },
        });
        send('message_stop', { type: 'message_stop' });
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lastNewline = buffer.lastIndexOf('\n');
          if (lastNewline === -1) continue;

          const complete = buffer.slice(0, lastNewline);
          buffer = buffer.slice(lastNewline + 1);

          for (const line of complete.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (!data || data === '[DONE]') continue;
            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(data);
            } catch {
              continue;
            }
            if (parsed.error) {
              // Upstream error mid-stream — surface as Anthropic error event.
              ensureStarted();
              send('error', { type: 'error', error: { type: 'api_error', message: 'Upstream stream error' } });
              continue;
            }
            handleChunk(parsed);
          }
        }
        ensureStarted();
        finish();
        controller.close();
      } catch (err) {
        try {
          send('error', { type: 'error', error: { type: 'api_error', message: err instanceof Error ? err.message : 'Stream error' } });
        } catch { /* connection closed */ }
        controller.close();
      } finally {
        try { reader.cancel(); } catch { /* already released */ }
      }
    },
  });
}

/**
 * Fastify handler for POST /v1/messages (Anthropic Messages format ingress).
 */
export function createMessagesHandler(config: FreeportConfig, registry: ProviderRegistry) {
  const log = getLogger();

  return async function handleMessages(request: FastifyRequest, reply: FastifyReply) {
    const startTime = performance.now();
    const body = request.body as AnthropicMessagesRequest;

    const freeportCtx = (request as any).freeportContext as
      { projectId?: string; apiKeyId?: string } | undefined;

    incGauge('freeport_active_requests');
    try {
      const openaiBody = normalizeAnthropicRequest(body);
      const result = await runCompletion(openaiBody, registry, config, startTime, freeportCtx);

      if (result.kind === 'stream') {
        const anthropicStreamBody = anthropicStream(result.streamResponse.stream, result.streamResponse.model);
        const wrapped = { ...result.streamResponse, stream: anthropicStreamBody };
        const { fullContent } = await pipeAnthropicStream(wrapped, reply);
        await result.finalize(fullContent);
        decGauge('freeport_active_requests');
        return;
      }

      decGauge('freeport_active_requests');
      return reply.send(serializeAnthropicResponse(result.response));
    } catch (err: unknown) {
      const error = err as Error & { statusCode?: number; code?: string };
      log.error({ err: error.message, statusCode: error.statusCode }, 'Anthropic ingress request failed');
      const statusCode = error.statusCode ?? 500;
      decGauge('freeport_active_requests');
      const safeMessage = statusCode >= 500 ? 'Internal server error' : error.message;
      return reply.status(statusCode).send({
        type: 'error',
        error: { type: error.code ?? 'api_error', message: safeMessage },
      });
    }
  };
}

/**
 * Pipe an Anthropic-format SSE stream to the reply, accumulating text for
 * post-processing/logging.
 */
async function pipeAnthropicStream(
  streamResponse: { stream: ReadableStream<Uint8Array> },
  reply: FastifyReply,
): Promise<{ fullContent: string }> {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const reader = streamResponse.stream.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let connectionOpen = true;

  reply.raw.on('close', () => { connectionOpen = false; });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (!connectionOpen) break;
      try {
        reply.raw.write(text);
      } catch {
        connectionOpen = false;
        break;
      }
      // Accumulate text_delta payloads for logging.
      for (const line of text.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            fullContent += parsed.delta.text ?? '';
          }
        } catch { /* skip */ }
      }
    }
  } finally {
    try { reader.cancel(); } catch { /* released */ }
    if (connectionOpen) {
      try { reply.raw.end(); } catch { /* ended */ }
    }
  }

  return { fullContent };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function systemToText(system: AnthropicMessagesRequest['system']): string {
  if (!system) return '';
  if (typeof system === 'string') return system;
  return system
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n\n');
}

function imageBlockToUrl(block: AnthropicImageBlock): string | null {
  const src = block.source;
  if (src.type === 'base64') return `data:${src.media_type};base64,${src.data}`;
  if (src.type === 'url') return src.url;
  return null;
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // Anthropic tool_result content can be an array of blocks.
    return content
      .map(b => {
        if (typeof b === 'string') return b;
        if (b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text') {
          return (b as { text?: string }).text ?? '';
        }
        return JSON.stringify(b);
      })
      .join('');
  }
  if (content == null) return '';
  return JSON.stringify(content);
}

function messageText(msg: ChatMessage): string {
  const c = msg.content;
  if (c == null) return '';
  if (typeof c === 'string') return c;
  return c.map(p => (p.type === 'text' ? p.text : '')).join('');
}

function mapFinishReason(reason: FinishReason): string {
  switch (reason) {
    case 'stop': return 'end_turn';
    case 'length': return 'max_tokens';
    case 'tool_calls': return 'tool_use';
    case 'function_call': return 'tool_use';
    case 'content_filter': return 'end_turn';
    default: return 'end_turn';
  }
}

function safeParseJson(s: string | undefined): unknown {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
