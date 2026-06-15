import { describe, it, expect } from 'vitest';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import type { CompletionRequest } from '../src/providers/base.js';

const provider = new AnthropicProvider('anthropic');
// transformRequest returns the typed AnthropicRequest; cast to any in tests to
// inspect the wire shape without re-declaring the internal interfaces.
const tr = (req: CompletionRequest) => provider.transformRequest(req) as any;

describe('Anthropic transformRequest — tools', () => {
  it('maps function parameters → input_schema', () => {
    const out = tr({
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{
        type: 'function',
        function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } },
      }],
    });
    expect(out.tools).toHaveLength(1);
    expect(out.tools[0]).toEqual({
      name: 'get_weather',
      description: 'Get weather',
      input_schema: { type: 'object', properties: { city: { type: 'string' } } },
    });
  });

  it('tool_choice variants', () => {
    const base = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user' as const, content: 'hi' }],
      tools: [{ type: 'function' as const, function: { name: 'f' } }],
    };
    expect(tr({ ...base, tool_choice: 'auto' }).tool_choice).toEqual({ type: 'auto' });
    expect(tr({ ...base, tool_choice: 'required' }).tool_choice).toEqual({ type: 'any' });
    expect(tr({ ...base, tool_choice: { type: 'function', function: { name: 'f' } } }).tool_choice)
      .toEqual({ type: 'tool', name: 'f' });

    // 'none' drops tools entirely
    const none = tr({ ...base, tool_choice: 'none' });
    expect(none.tools).toBeUndefined();
    expect(none.tool_choice).toBeUndefined();
  });
});

describe('Anthropic transformRequest — vision', () => {
  it('base64 data-URL → source.type base64 with media_type', () => {
    const out = tr({
      model: 'claude-3-5-sonnet',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'what is this' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
        ],
      }],
    });
    const blocks = out.messages[0].content;
    expect(blocks[0]).toEqual({ type: 'text', text: 'what is this' });
    expect(blocks[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' },
    });
  });

  it('http url → source.type url', () => {
    const out = tr({
      model: 'claude-3-5-sonnet',
      messages: [{
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'https://example.com/cat.jpg' } }],
      }],
    });
    expect(out.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://example.com/cat.jpg' },
    });
  });
});

describe('Anthropic transformRequest — system accumulation', () => {
  it('joins multiple system messages', () => {
    const out = tr({
      model: 'claude-3-5-sonnet',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(out.system).toBe('You are helpful.\n\nBe concise.');
  });

  it('clamps temperature to 1', () => {
    const out = tr({ model: 'm', messages: [{ role: 'user', content: 'hi' }], temperature: 1.5 });
    expect(out.temperature).toBe(1);
  });
});

describe('Anthropic transformRequest — tool results + coalescing', () => {
  it('coalesces adjacent tool messages into one user msg with correlated tool_result blocks', () => {
    const out = tr({
      model: 'claude-3-5-sonnet',
      messages: [
        { role: 'user', content: 'weather in 2 cities?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'w', arguments: '{"city":"NY"}' } },
            { id: 'call_2', type: 'function', function: { name: 'w', arguments: '{"city":"LA"}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'sunny' },
        { role: 'tool', tool_call_id: 'call_2', content: 'cloudy' },
      ],
    });

    // assistant turn has two tool_use blocks parsed from arguments
    const asst = out.messages[1];
    expect(asst.role).toBe('assistant');
    expect(asst.content.filter((b: any) => b.type === 'tool_use')).toHaveLength(2);
    expect(asst.content.find((b: any) => b.id === 'call_1').input).toEqual({ city: 'NY' });

    // the two tool messages coalesce into a single user message
    const toolMsg = out.messages[2];
    expect(toolMsg.role).toBe('user');
    expect(toolMsg.content).toHaveLength(2);
    expect(toolMsg.content[0]).toEqual({ type: 'tool_result', tool_use_id: 'call_1', content: 'sunny' });
    expect(toolMsg.content[1]).toEqual({ type: 'tool_result', tool_use_id: 'call_2', content: 'cloudy' });
    expect(out.messages).toHaveLength(3);
  });
});

describe('Anthropic response_format — forced tool injection + unwrap', () => {
  it('json_schema injects json_output tool + forced tool_choice', () => {
    const out = tr({
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'give me json' }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'out', schema: { type: 'object', properties: { x: { type: 'number' } } } },
      },
    });
    const jsonTool = out.tools.find((t: any) => t.name === 'json_output');
    expect(jsonTool.input_schema).toEqual({ type: 'object', properties: { x: { type: 'number' } } });
    expect(out.tool_choice).toEqual({ type: 'tool', name: 'json_output' });
  });

  it('unwraps json_output tool_use into JSON-string content with finish stop', () => {
    const resp = provider.transformResponse({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't', name: 'json_output', input: { x: 42 } }],
      model: 'claude-3-5-sonnet',
      stop_reason: 'tool_use',
      usage: { input_tokens: 5, output_tokens: 3 },
    }, 'claude-3-5-sonnet');

    expect(resp.choices[0].message.content).toBe('{"x":42}');
    expect(resp.choices[0].message.tool_calls).toBeUndefined();
    expect(resp.choices[0].finish_reason).toBe('stop');
  });
});

describe('Anthropic transformResponse — tool_use → tool_calls', () => {
  it('maps tool_use block to tool_calls with stringified arguments + tool_calls finish', () => {
    const resp = provider.transformResponse({
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'let me check' },
        { type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: 'SF' } },
      ],
      model: 'claude-3-5-sonnet',
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 4 },
    }, 'claude-3-5-sonnet');

    expect(resp.choices[0].message.content).toBe('let me check');
    const tc = resp.choices[0].message.tool_calls!;
    expect(tc).toHaveLength(1);
    expect(tc[0]).toEqual({
      id: 'tu_1', type: 'function',
      function: { name: 'get_weather', arguments: '{"city":"SF"}' },
    });
    expect(resp.choices[0].finish_reason).toBe('tool_calls');
  });

  it('tool-only response (no text) sets content null', () => {
    const resp = provider.transformResponse({
      id: 'msg_3', type: 'message', role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu', name: 'f', input: {} }],
      model: 'm', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
    }, 'm');
    expect(resp.choices[0].message.content).toBeNull();
  });
});

describe('Anthropic streaming — tool-call delta reconstruction', () => {
  async function collectChunks(stream: ReadableStream<Uint8Array>): Promise<any[]> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const chunks: any[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
    }
    for (const line of buf.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const d = line.slice(6).trim();
      if (!d || d === '[DONE]') continue;
      chunks.push(JSON.parse(d));
    }
    return chunks;
  }

  function sseStream(events: object[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const e of events) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        }
        controller.close();
      },
    });
  }

  it('rebuilds tool_calls[0].function.arguments from input_json_delta fragments', async () => {
    const input = sseStream([
      { type: 'message_start', message: { id: 'msg_x' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_9', name: 'get_weather' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"ci' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'ty":"' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'SF"}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } },
    ]);

    // access private transformStream via the public stream method shape:
    // call the private method directly through a cast for unit isolation.
    const stream = (provider as any).transformStream(input, 'claude-3-5-sonnet');
    const chunks = await collectChunks(stream);

    // first tool chunk carries id+name, index 0
    const startChunk = chunks.find(c => c.choices[0].delta.tool_calls?.[0]?.id === 'tu_9');
    expect(startChunk.choices[0].delta.tool_calls[0]).toEqual({
      index: 0, id: 'tu_9', type: 'function', function: { name: 'get_weather', arguments: '' },
    });

    // concatenate all argument fragments across deltas
    let args = '';
    for (const c of chunks) {
      const tc = c.choices[0].delta.tool_calls?.[0];
      if (tc && tc.function?.arguments !== undefined && tc.id === undefined) {
        expect(tc.index).toBe(0);
        args += tc.function.arguments;
      }
    }
    expect(args).toBe('{"city":"SF"}');

    const finishChunk = chunks.find(c => c.choices[0].finish_reason === 'tool_calls');
    expect(finishChunk).toBeDefined();
  });
});
