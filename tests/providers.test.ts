import { describe, it, expect } from 'vitest';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { GoogleProvider } from '../src/providers/google.js';
import { OpenAIProvider } from '../src/providers/openai.js';

describe('OpenAI Provider', () => {
  const provider = new OpenAIProvider('openai');

  it('passes through request unchanged', () => {
    const req = {
      model: 'gpt-4o',
      messages: [{ role: 'user' as const, content: 'Hello' }],
      temperature: 0.5,
    };
    const transformed = provider.transformRequest(req);
    expect(transformed.model).toBe('gpt-4o');
    expect(transformed.messages).toEqual(req.messages);
  });

  it('transforms response correctly', () => {
    const raw = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hi!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const resp = provider.transformResponse(raw, 'gpt-4o');
    expect(resp.choices[0].message.content).toBe('Hi!');
    expect(resp.usage.total_tokens).toBe(15);
  });
});

describe('Anthropic Provider', () => {
  const provider = new AnthropicProvider('anthropic');

  it('extracts system message from messages array', () => {
    const req = {
      model: 'claude-sonnet-4-5-20250929',
      messages: [
        { role: 'system' as const, content: 'You are helpful.' },
        { role: 'user' as const, content: 'Hello' },
      ],
    };
    const transformed = provider.transformRequest(req);

    expect(transformed.system).toBe('You are helpful.');
    expect(transformed.messages).toHaveLength(1);
    expect(transformed.messages[0].role).toBe('user');
  });

  it('sets default max_tokens to 4096', () => {
    const req = {
      model: 'claude-sonnet-4-5-20250929',
      messages: [{ role: 'user' as const, content: 'Hi' }],
    };
    const transformed = provider.transformRequest(req);
    expect(transformed.max_tokens).toBe(4096);
  });

  it('transforms response to OpenAI format', () => {
    const raw = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello there!' }],
      model: 'claude-sonnet-4-5-20250929',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const resp = provider.transformResponse(raw, 'claude-sonnet-4-5-20250929');

    expect(resp.object).toBe('chat.completion');
    expect(resp.choices[0].message.content).toBe('Hello there!');
    expect(resp.choices[0].finish_reason).toBe('stop');
    expect(resp.usage.total_tokens).toBe(15);
  });

  it('handles stop sequences', () => {
    const req = {
      model: 'claude-sonnet-4-5-20250929',
      messages: [{ role: 'user' as const, content: 'Hi' }],
      stop: ['END', 'STOP'],
    };
    const transformed = provider.transformRequest(req);
    expect(transformed.stop_sequences).toEqual(['END', 'STOP']);
  });
});

describe('Google Provider', () => {
  const provider = new GoogleProvider('google');

  it('transforms request to Gemini format', () => {
    const req = {
      model: 'gemini-2.0-flash',
      messages: [
        { role: 'system' as const, content: 'Be concise.' },
        { role: 'user' as const, content: 'What is 2+2?' },
      ],
      temperature: 0.3,
      max_tokens: 100,
    };
    const transformed = provider.transformRequest(req);

    expect(transformed.systemInstruction).toEqual({ parts: [{ text: 'Be concise.' }] });
    expect(transformed.contents).toHaveLength(1);
    expect(transformed.contents[0].role).toBe('user');
    expect(transformed.generationConfig?.temperature).toBe(0.3);
    expect(transformed.generationConfig?.maxOutputTokens).toBe(100);
  });

  it('maps assistant role to model role', () => {
    const req = {
      model: 'gemini-2.0-flash',
      messages: [
        { role: 'user' as const, content: 'Hi' },
        { role: 'assistant' as const, content: 'Hello!' },
        { role: 'user' as const, content: 'How are you?' },
      ],
    };
    const transformed = provider.transformRequest(req);

    expect(transformed.contents[0].role).toBe('user');
    expect(transformed.contents[1].role).toBe('model');
    expect(transformed.contents[2].role).toBe('user');
  });

  it('transforms response to OpenAI format', () => {
    const raw = {
      candidates: [{
        content: { parts: [{ text: 'Four!' }], role: 'model' },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
    };
    const resp = provider.transformResponse(raw, 'gemini-2.0-flash');

    expect(resp.object).toBe('chat.completion');
    expect(resp.choices[0].message.content).toBe('Four!');
    expect(resp.choices[0].finish_reason).toBe('stop');
    expect(resp.usage.total_tokens).toBe(13);
  });

  it('maps SAFETY finish reason to content_filter', () => {
    const raw = {
      candidates: [{
        content: { parts: [{ text: '' }], role: 'model' },
        finishReason: 'SAFETY',
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0, totalTokenCount: 10 },
    };
    const resp = provider.transformResponse(raw, 'gemini-2.0-flash');
    expect(resp.choices[0].finish_reason).toBe('content_filter');
  });
});
