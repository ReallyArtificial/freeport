import { describe, it, expect } from 'vitest';
import { normalizeRequest } from '../src/proxy/transformer.js';
import type { CompletionRequest, ToolDef, ResponseFormat } from '../src/providers/base.js';

describe('canonical request carries new superset fields (OpenAI passthrough)', () => {
  it('passes tools and tool_choice through normalizeRequest', () => {
    const tools: ToolDef[] = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      },
    ];
    const req = normalizeRequest({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'weather?' }],
      tools,
      tool_choice: { type: 'function', function: { name: 'get_weather' } },
    });

    expect(req.tools).toEqual(tools);
    expect(req.tool_choice).toEqual({ type: 'function', function: { name: 'get_weather' } });
  });

  it('passes response_format through', () => {
    const response_format: ResponseFormat = {
      type: 'json_schema',
      json_schema: { name: 'out', schema: { type: 'object' } },
    };
    const req = normalizeRequest({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'json' }],
      response_format,
    });
    expect(req.response_format).toEqual(response_format);
  });

  it('passes extended sampling params through', () => {
    const req = normalizeRequest({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'x' }],
      n: 2,
      presence_penalty: 0.5,
      frequency_penalty: -0.2,
      seed: 42,
      user: 'user-123',
      parallel_tool_calls: false,
      stream_options: { include_usage: true },
    });

    const r = req as CompletionRequest;
    expect(r.n).toBe(2);
    expect(r.presence_penalty).toBe(0.5);
    expect(r.frequency_penalty).toBe(-0.2);
    expect(r.seed).toBe(42);
    expect(r.user).toBe('user-123');
    expect(r.parallel_tool_calls).toBe(false);
    expect(r.stream_options).toEqual({ include_usage: true });
  });

  it('accepts multimodal array content in messages', () => {
    const req = normalizeRequest({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          ],
        },
      ],
    });
    expect(Array.isArray(req.messages[0].content)).toBe(true);
    expect((req.messages[0].content as unknown[]).length).toBe(2);
  });
});
