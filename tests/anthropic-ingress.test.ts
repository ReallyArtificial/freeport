import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/server.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { initDb, closeDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/runner.js';
import { initLogger } from '../src/logging/logger.js';
import { resetMetrics } from '../src/observability/metrics.js';
import {
  normalizeAnthropicRequest,
  serializeAnthropicResponse,
  anthropicStream,
} from '../src/proxy/anthropic-ingress.js';
import type { CompletionResponse } from '../src/providers/base.js';
import type { FastifyInstance } from 'fastify';
import type { FreeportConfig } from '../src/config/types.js';
import http from 'node:http';

initLogger('silent');

// ── Helpers to drive the in-memory transform stream ────────────────────────

function streamFromSSE(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
}

async function drainStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

/** Parse SSE text into [{event, data}] entries. */
function parseSSE(text: string): Array<{ event: string; data: any }> {
  const events: Array<{ event: string; data: any }> = [];
  for (const block of text.split('\n\n')) {
    if (!block.trim()) continue;
    let event = 'message';
    let data: any = undefined;
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      else if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim();
        try { data = JSON.parse(raw); } catch { data = raw; }
      }
    }
    events.push({ event, data });
  }
  return events;
}

// ── Unit: request parsing ──────────────────────────────────────────────────

describe('normalizeAnthropicRequest', () => {
  it('maps a string system field to a leading system message', () => {
    const out = normalizeAnthropicRequest({
      model: 'claude-x',
      system: 'be terse',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 100,
    });
    expect((out.messages as any[])[0]).toEqual({ role: 'system', content: 'be terse' });
    expect((out.messages as any[])[1]).toEqual({ role: 'user', content: 'hi' });
    expect(out.max_tokens).toBe(100);
  });

  it('maps a block-array system field to a joined system message', () => {
    const out = normalizeAnthropicRequest({
      model: 'claude-x',
      system: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 50,
    });
    expect((out.messages as any[])[0]).toEqual({ role: 'system', content: 'a\n\nb' });
  });

  it('maps tool_result blocks to a tool role message with tool_call_id', () => {
    const out = normalizeAnthropicRequest({
      model: 'claude-x',
      max_tokens: 50,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_42', content: 'sunny, 72F' },
          ],
        },
      ],
    });
    const msgs = out.messages as any[];
    expect(msgs[0]).toEqual({ role: 'tool', tool_call_id: 'toolu_42', content: 'sunny, 72F' });
  });

  it('maps tool_use blocks on an assistant turn to tool_calls', () => {
    const out = normalizeAnthropicRequest({
      model: 'claude-x',
      max_tokens: 50,
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'let me check' },
            { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'SF' } },
          ],
        },
      ],
    });
    const m = (out.messages as any[])[0];
    expect(m.role).toBe('assistant');
    expect(m.tool_calls[0]).toEqual({
      id: 'toolu_1',
      type: 'function',
      function: { name: 'get_weather', arguments: JSON.stringify({ city: 'SF' }) },
    });
  });

  it('maps tools to OpenAI function tools (input_schema -> parameters)', () => {
    const out = normalizeAnthropicRequest({
      model: 'claude-x',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'get_weather', description: 'gets weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }],
    });
    expect((out.tools as any[])[0]).toEqual({
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'gets weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    });
  });

  it('maps tool_choice any -> required, tool -> function, none -> none', () => {
    expect(normalizeAnthropicRequest({ model: 'm', max_tokens: 1, messages: [], tool_choice: { type: 'any' } }).tool_choice).toBe('required');
    expect(normalizeAnthropicRequest({ model: 'm', max_tokens: 1, messages: [], tool_choice: { type: 'none' } }).tool_choice).toBe('none');
    expect(normalizeAnthropicRequest({ model: 'm', max_tokens: 1, messages: [], tool_choice: { type: 'tool', name: 'f' } }).tool_choice)
      .toEqual({ type: 'function', function: { name: 'f' } });
  });

  it('maps image blocks (base64 + url) to image_url content parts', () => {
    const out = normalizeAnthropicRequest({
      model: 'm',
      max_tokens: 1,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
            { type: 'image', source: { type: 'url', url: 'https://x/y.png' } },
          ],
        },
      ],
    });
    const parts = (out.messages as any[])[0].content;
    expect(parts[0]).toEqual({ type: 'text', text: 'describe' });
    expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
    expect(parts[2]).toEqual({ type: 'image_url', image_url: { url: 'https://x/y.png' } });
  });
});

// ── Unit: response serialization ───────────────────────────────────────────

describe('serializeAnthropicResponse', () => {
  it('serializes a text response', () => {
    const resp: CompletionResponse = {
      id: 'chatcmpl-abc', object: 'chat.completion', created: 1, model: 'claude-x',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hello there' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    };
    const out = serializeAnthropicResponse(resp);
    expect(out.type).toBe('message');
    expect(out.role).toBe('assistant');
    expect(out.content).toEqual([{ type: 'text', text: 'hello there' }]);
    expect(out.stop_reason).toBe('end_turn');
    expect(out.usage).toEqual({ input_tokens: 5, output_tokens: 3 });
  });

  it('serializes tool_calls to tool_use blocks and tool_calls finish -> tool_use', () => {
    const resp: CompletionResponse = {
      id: 'chatcmpl-x', object: 'chat.completion', created: 1, model: 'claude-x',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    };
    const out = serializeAnthropicResponse(resp);
    expect(out.stop_reason).toBe('tool_use');
    expect(out.content).toEqual([{ type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'SF' } }]);
  });

  it('always emits at least one content block', () => {
    const resp: CompletionResponse = {
      id: 'c', object: 'chat.completion', created: 1, model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
    expect((serializeAnthropicResponse(resp).content as any[]).length).toBe(1);
  });
});

// ── Unit: stream serialization ─────────────────────────────────────────────

describe('anthropicStream (OpenAI SSE -> Anthropic SSE)', () => {
  it('emits ordered named events for a text stream', async () => {
    const chunk = (delta: any, finish: any = null) =>
      `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const input = streamFromSSE([
      chunk({ role: 'assistant', content: '' }),
      chunk({ content: 'Hel' }),
      chunk({ content: 'lo' }),
      chunk({}, 'stop'),
      'data: [DONE]\n\n',
    ]);
    const out = await drainStream(anthropicStream(input, 'claude-x'));
    const events = parseSSE(out);
    const names = events.map(e => e.event);
    expect(names[0]).toBe('message_start');
    expect(names).toContain('content_block_start');
    expect(names).toContain('content_block_delta');
    expect(names).toContain('content_block_stop');
    expect(names).toContain('message_delta');
    expect(names[names.length - 1]).toBe('message_stop');

    const text = events
      .filter(e => e.event === 'content_block_delta' && e.data.delta?.type === 'text_delta')
      .map(e => e.data.delta.text)
      .join('');
    expect(text).toBe('Hello');

    const msgDelta = events.find(e => e.event === 'message_delta');
    expect(msgDelta!.data.delta.stop_reason).toBe('end_turn');
  });

  it('reconstructs tool-call partial_json fragments verbatim in order', async () => {
    const chunk = (delta: any, finish: any = null) =>
      `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const input = streamFromSSE([
      chunk({ role: 'assistant', content: '' }),
      chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"ci' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: 'ty":"SF"}' } }] }),
      chunk({}, 'tool_calls'),
      'data: [DONE]\n\n',
    ]);
    const out = await drainStream(anthropicStream(input, 'claude-x'));
    const events = parseSSE(out);

    const start = events.find(e => e.event === 'content_block_start' && e.data.content_block?.type === 'tool_use');
    expect(start).toBeTruthy();
    expect(start!.data.content_block.name).toBe('get_weather');
    expect(start!.data.content_block.id).toBe('call_1');

    const partials = events
      .filter(e => e.event === 'content_block_delta' && e.data.delta?.type === 'input_json_delta')
      .map(e => e.data.delta.partial_json)
      .join('');
    expect(partials).toBe('{"city":"SF"}');

    const msgDelta = events.find(e => e.event === 'message_delta');
    expect(msgDelta!.data.delta.stop_reason).toBe('tool_use');
  });
});

// ── Integration: end-to-end against a mocked OpenAI upstream ───────────────

function createMockLLM(): Promise<{ server: http.Server; port: number; lastBody: () => any }> {
  let captured: any = null;
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/v1/chat/completions') {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          captured = JSON.parse(body);

          if (captured.stream) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            // Emit a tool-call stream if tools were requested, else text.
            if (captured.tools) {
              const c = (delta: any, finish: any = null) =>
                `data: ${JSON.stringify({ model: captured.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
              res.write(c({ role: 'assistant', content: '' }));
              res.write(c({ tool_calls: [{ index: 0, id: 'call_99', type: 'function', function: { name: 'get_weather', arguments: '' } }] }));
              res.write(c({ tool_calls: [{ index: 0, function: { arguments: '{"city":"SF"}' } }] }));
              res.write(c({}, 'tool_calls'));
            } else {
              const c = (delta: any, finish: any = null) =>
                `data: ${JSON.stringify({ model: captured.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
              res.write(c({ role: 'assistant', content: 'Hello ' }));
              res.write(c({ content: 'world' }));
              res.write(c({}, 'stop'));
            }
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }

          // Non-streaming
          if (captured.tools) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              id: 'chatcmpl-tool', object: 'chat.completion', created: 1, model: captured.model,
              choices: [{
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [{ id: 'call_99', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } }],
                },
                finish_reason: 'tool_calls',
              }],
              usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
            }));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'chatcmpl-mock', object: 'chat.completion', created: 1, model: captured.model,
            choices: [{ index: 0, message: { role: 'assistant', content: 'Hello from mock!' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }));
        });
        return;
      }
      res.writeHead(404);
      res.end('nope');
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port, lastBody: () => captured });
    });
  });
}

function makeConfig(mockPort: number, overrides: Partial<FreeportConfig> = {}): FreeportConfig {
  return {
    server: { host: '127.0.0.1', port: 0 },
    providers: [{
      name: 'mock-openai',
      type: 'openai',
      apiBase: `http://127.0.0.1:${mockPort}`,
      keys: [{ key: 'sk-mock' }],
      models: ['claude-sonnet-4-5-20250929', 'gpt-4o'],
    }],
    auth: { adminApiKey: 'admin', apiKey: 'proxy-key' },
    ...overrides,
  };
}

let app: FastifyInstance | null = null;
let mock: { server: http.Server; port: number; lastBody: () => any } | null = null;

beforeEach(async () => {
  const db = initDb(':memory:');
  runMigrations(db);
  resetMetrics();
  mock = await createMockLLM();
});

afterEach(async () => {
  if (app) { await app.close(); app = null; }
  if (mock) { await new Promise<void>(r => mock!.server.close(() => r())); mock = null; }
  closeDb();
});

describe('E2E /v1/messages (Anthropic ingress)', () => {
  it('non-streaming: returns an Anthropic-shaped message', async () => {
    const config = makeConfig(mock!.port);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: 'Bearer proxy-key', 'anthropic-version': '2023-06-01' },
      payload: {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 256,
        system: 'be nice',
        messages: [{ role: 'user', content: 'hi' }],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.type).toBe('message');
    expect(body.role).toBe('assistant');
    expect(body.content[0]).toEqual({ type: 'text', text: 'Hello from mock!' });
    expect(body.stop_reason).toBe('end_turn');
    expect(body.usage).toEqual({ input_tokens: 10, output_tokens: 5 });

    // The pipeline forwarded a proper OpenAI body with the system message.
    const upstream = mock!.lastBody();
    expect(upstream.messages[0]).toEqual({ role: 'system', content: 'be nice' });
  });

  it('authenticates via x-api-key (Anthropic SDK style, no Authorization header)', async () => {
    const config = makeConfig(mock!.port);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const ok = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'x-api-key': 'proxy-key', 'anthropic-version': '2023-06-01' },
      payload: {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hi' }],
      },
    });
    expect(ok.statusCode).toBe(200);

    const bad = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'x-api-key': 'wrong-key' },
      payload: {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hi' }],
      },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('streaming: emits Anthropic named-event SSE', async () => {
    const config = makeConfig(mock!.port);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: 'Bearer proxy-key' },
      payload: {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 256,
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseSSE(res.payload);
    const names = events.map(e => e.event);
    expect(names[0]).toBe('message_start');
    expect(names[names.length - 1]).toBe('message_stop');

    const text = events
      .filter(e => e.event === 'content_block_delta' && e.data.delta?.type === 'text_delta')
      .map(e => e.data.delta.text).join('');
    expect(text).toBe('Hello world');
  });

  it('tools round-trip: tool request -> tool_use response (non-streaming)', async () => {
    const config = makeConfig(mock!.port);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: 'Bearer proxy-key' },
      payload: {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 256,
        messages: [{ role: 'user', content: 'weather in SF?' }],
        tools: [{ name: 'get_weather', description: 'gets weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }],
        tool_choice: { type: 'any' },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stop_reason).toBe('tool_use');
    expect(body.content[0]).toEqual({ type: 'tool_use', id: 'call_99', name: 'get_weather', input: { city: 'SF' } });

    // Verify the tool definition survived the canonical hop to the upstream.
    const upstream = mock!.lastBody();
    expect(upstream.tools[0].function.name).toBe('get_weather');
    expect(upstream.tools[0].function.parameters.properties.city.type).toBe('string');
    expect(upstream.tool_choice).toBe('required');
  });

  it('tools round-trip: streaming tool_use SSE concatenates to original arguments', async () => {
    const config = makeConfig(mock!.port);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: 'Bearer proxy-key' },
      payload: {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 256,
        stream: true,
        messages: [{ role: 'user', content: 'weather?' }],
        tools: [{ name: 'get_weather', input_schema: { type: 'object' } }],
      },
    });

    expect(res.statusCode).toBe(200);
    const events = parseSSE(res.payload);
    const start = events.find(e => e.event === 'content_block_start' && e.data.content_block?.type === 'tool_use');
    expect(start!.data.content_block.name).toBe('get_weather');
    const partials = events
      .filter(e => e.event === 'content_block_delta' && e.data.delta?.type === 'input_json_delta')
      .map(e => e.data.delta.partial_json).join('');
    expect(partials).toBe('{"city":"SF"}');
    const msgDelta = events.find(e => e.event === 'message_delta');
    expect(msgDelta!.data.delta.stop_reason).toBe('tool_use');
  });

  it('full image + tool_use + tool_result round-trip survives canonical hop', async () => {
    const config = makeConfig(mock!.port);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: 'Bearer proxy-key' },
      payload: {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'whats in this image and the weather?' },
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'Zm9v' } },
            ],
          },
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'toolu_a', name: 'get_weather', input: { city: 'SF' } },
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'toolu_a', content: 'sunny 72F' },
            ],
          },
        ],
      },
    });

    const upstream = mock!.lastBody();
    // image preserved as data URL
    const userMsg = upstream.messages.find((m: any) => Array.isArray(m.content));
    const img = userMsg.content.find((p: any) => p.type === 'image_url');
    expect(img.image_url.url).toBe('data:image/jpeg;base64,Zm9v');
    // tool_use -> tool_calls preserved with input JSON intact
    const assistant = upstream.messages.find((m: any) => m.role === 'assistant');
    expect(assistant.tool_calls[0].function.name).toBe('get_weather');
    expect(JSON.parse(assistant.tool_calls[0].function.arguments)).toEqual({ city: 'SF' });
    // tool_result -> tool message preserved with correct id
    const toolMsg = upstream.messages.find((m: any) => m.role === 'tool');
    expect(toolMsg.tool_call_id).toBe('toolu_a');
    expect(toolMsg.content).toBe('sunny 72F');
  });

  it('count_tokens stub returns 501', async () => {
    const config = makeConfig(mock!.port);
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/count_tokens',
      headers: { authorization: 'Bearer proxy-key' },
      payload: { model: 'claude-x', messages: [] },
    });
    expect(res.statusCode).toBe(501);
  });
});

describe('E2E /v1/embeddings (provider-aware)', () => {
  it('rejects a non-OpenAI-format provider model with 400', async () => {
    const config: FreeportConfig = {
      server: { host: '127.0.0.1', port: 0 },
      providers: [{
        name: 'anthropic',
        type: 'anthropic',
        keys: [{ key: 'sk-ant' }],
        models: ['claude-embed'],
      }],
      auth: { adminApiKey: 'admin', apiKey: 'proxy-key' },
    };
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: { authorization: 'Bearer proxy-key' },
      payload: { model: 'claude-embed', input: 'hi' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('does not support');
  });

  it('routes an openai-compatible embeddings model to its apiBase with header auth', async () => {
    let capturedAuth: string | undefined;
    const embedMock = await new Promise<{ server: http.Server; port: number }>((resolve) => {
      const server = http.createServer((req, res) => {
        if (req.url?.startsWith('/custom/embeddings')) {
          capturedAuth = req.headers['api-key'] as string;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ object: 'list', data: [{ embedding: [0.1, 0.2] }] }));
          return;
        }
        res.writeHead(404); res.end();
      });
      server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as any).port }));
    });

    const config: FreeportConfig = {
      server: { host: '127.0.0.1', port: 0 },
      providers: [{
        name: 'compat',
        type: 'openai-compatible',
        apiBase: `http://127.0.0.1:${embedMock.port}`,
        authStyle: 'header',
        authHeaderName: 'api-key',
        embeddingsPath: '/custom/embeddings',
        keys: [{ key: 'azure-key' }],
        models: ['my-embed'],
      }],
      auth: { adminApiKey: 'admin', apiKey: 'proxy-key' },
    };
    const registry = new ProviderRegistry();
    registry.register(config.providers[0]);
    app = await createServer(config, registry);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: { authorization: 'Bearer proxy-key' },
      payload: { model: 'my-embed', input: 'hi' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].embedding).toEqual([0.1, 0.2]);
    expect(capturedAuth).toBe('azure-key');

    await new Promise<void>(r => embedMock.server.close(() => r()));
  });
});
