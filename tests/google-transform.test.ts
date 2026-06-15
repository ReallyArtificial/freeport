import { describe, it, expect } from 'vitest';
import { GoogleProvider } from '../src/providers/google.js';
import type { CompletionRequest } from '../src/providers/base.js';

const provider = new GoogleProvider('google');
const tr = (req: CompletionRequest) => provider.transformRequest(req) as any;

describe('Google transformRequest — tools', () => {
  it('maps tools → functionDeclarations', () => {
    const out = tr({
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{
        type: 'function',
        function: { name: 'get_weather', description: 'w', parameters: { type: 'object', additionalProperties: false } },
      }],
    });
    expect(out.tools).toHaveLength(1);
    expect(out.tools[0].functionDeclarations[0].name).toBe('get_weather');
    expect(out.tools[0].functionDeclarations[0].description).toBe('w');
    // unsupported keyword stripped from parameters
    expect(out.tools[0].functionDeclarations[0].parameters).toEqual({ type: 'object' });
  });

  it('tool_choice → functionCallingConfig modes', () => {
    const base = {
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user' as const, content: 'hi' }],
      tools: [{ type: 'function' as const, function: { name: 'f' } }],
    };
    expect(tr({ ...base, tool_choice: 'auto' }).toolConfig.functionCallingConfig).toEqual({ mode: 'AUTO' });
    expect(tr({ ...base, tool_choice: 'none' }).toolConfig.functionCallingConfig).toEqual({ mode: 'NONE' });
    expect(tr({ ...base, tool_choice: 'required' }).toolConfig.functionCallingConfig).toEqual({ mode: 'ANY' });
    expect(tr({ ...base, tool_choice: { type: 'function', function: { name: 'f' } } }).toolConfig.functionCallingConfig)
      .toEqual({ mode: 'ANY', allowedFunctionNames: ['f'] });
  });
});

describe('Google transformRequest — vision', () => {
  it('base64 data-URL → inline_data', () => {
    const out = tr({
      model: 'gemini-2.0-flash',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4AAQ' } },
        ],
      }],
    });
    const parts = out.contents[0].parts;
    expect(parts[0]).toEqual({ text: 'describe' });
    expect(parts[1]).toEqual({ inline_data: { mime_type: 'image/jpeg', data: '/9j/4AAQ' } });
  });

  it('http url → file_data.file_uri', () => {
    const out = tr({
      model: 'gemini-2.0-flash',
      messages: [{
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'https://example.com/x.png' } }],
      }],
    });
    expect(out.contents[0].parts[0].file_data.file_uri).toBe('https://example.com/x.png');
  });
});

describe('Google transformRequest — tool results by-name correlation', () => {
  it('resolves functionResponse name via callId→name map; wraps non-JSON as {result}', () => {
    const out = tr({
      model: 'gemini-2.0-flash',
      messages: [
        { role: 'user', content: 'weather?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_77', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } }],
        },
        { role: 'tool', tool_call_id: 'call_77', content: 'sunny and 70F' },
      ],
    });

    // assistant turn → functionCall
    const modelTurn = out.contents[1];
    expect(modelTurn.role).toBe('model');
    expect(modelTurn.parts[0].functionCall).toEqual({ name: 'get_weather', args: { city: 'SF' } });

    // tool turn → functionResponse correlated by NAME (not id), non-JSON wrapped
    const toolTurn = out.contents[2];
    expect(toolTurn.role).toBe('user');
    expect(toolTurn.parts[0].functionResponse).toEqual({
      name: 'get_weather',
      response: { result: 'sunny and 70F' },
    });
  });
});

describe('Google transformRequest — response_format', () => {
  it('json_schema → responseMimeType + stripped responseSchema', () => {
    const out = tr({
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'hi' }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          schema: { $schema: 'http://x', type: 'object', additionalProperties: false, properties: { y: { type: 'string' } } },
        },
      },
    });
    expect(out.generationConfig.responseMimeType).toBe('application/json');
    expect(out.generationConfig.responseSchema).toEqual({ type: 'object', properties: { y: { type: 'string' } } });
  });

  it('json_object → responseMimeType only', () => {
    const out = tr({
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'hi' }],
      response_format: { type: 'json_object' },
    });
    expect(out.generationConfig.responseMimeType).toBe('application/json');
    expect(out.generationConfig.responseSchema).toBeUndefined();
  });
});

describe('Google transformResponse — functionCall → tool_calls', () => {
  it('maps functionCall part to tool_calls (synth call_ id) + tool_calls finish', () => {
    const resp = provider.transformResponse({
      candidates: [{
        content: { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { city: 'NY' } } }] },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
    }, 'gemini-2.0-flash');

    const tc = resp.choices[0].message.tool_calls!;
    expect(tc).toHaveLength(1);
    expect(tc[0].id).toMatch(/^call_/);
    expect(tc[0].function).toEqual({ name: 'get_weather', arguments: '{"city":"NY"}' });
    expect(resp.choices[0].message.content).toBeNull();
    expect(resp.choices[0].finish_reason).toBe('tool_calls');
  });

  it('maps SAFETY finishReason to content_filter', () => {
    const resp = provider.transformResponse({
      candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, finishReason: 'SAFETY' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 0, totalTokenCount: 1 },
    }, 'gemini-2.0-flash');
    expect(resp.choices[0].finish_reason).toBe('content_filter');
  });
});

describe('Google streaming — functionCall single-emit + dedup', () => {
  async function collectChunks(stream: ReadableStream<Uint8Array>): Promise<any[]> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
    }
    const chunks: any[] = [];
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
        for (const e of events) controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        controller.close();
      },
    });
  }

  it('emits one tool_call delta, dedups cumulative re-send, keeps text deltas', async () => {
    const input = sseStream([
      { candidates: [{ content: { role: 'model', parts: [{ text: 'Hello' }] }, finishReason: null }] },
      { candidates: [{ content: { role: 'model', parts: [{ text: 'Hello world' }] }, finishReason: null }] },
      { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'f', args: { a: 1 } } }] }, finishReason: null }] },
      // duplicate functionCall re-send — must be deduped
      { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'f', args: { a: 1 } } }] }, finishReason: 'STOP' }] },
    ]);

    const stream = (provider as any).transformStream(input, 'gemini-2.0-flash');
    const chunks = await collectChunks(stream);

    const toolChunks = chunks.filter(c => c.choices[0].delta.tool_calls);
    expect(toolChunks).toHaveLength(1);
    expect(toolChunks[0].choices[0].delta.tool_calls[0].function).toEqual({ name: 'f', arguments: '{"a":1}' });

    // text deltas: "Hello" then " world"
    const textDeltas = chunks
      .filter(c => typeof c.choices[0].delta.content === 'string' && c.choices[0].delta.content)
      .map(c => c.choices[0].delta.content);
    expect(textDeltas.join('')).toBe('Hello world');
  });
});
