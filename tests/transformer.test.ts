import { describe, it, expect } from 'vitest';
import { normalizeRequest, extractFreeportMetadata, extractPromptText } from '../src/proxy/transformer.js';

describe('normalizeRequest', () => {
  it('normalizes chat completions format', () => {
    const req = normalizeRequest({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.7,
      stream: false,
    });

    expect(req.model).toBe('gpt-4o');
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].content).toBe('Hello');
    expect(req.temperature).toBe(0.7);
    expect(req.stream).toBe(false);
  });

  it('normalizes legacy completions format', () => {
    const req = normalizeRequest({
      model: 'gpt-3.5-turbo',
      prompt: 'Hello world',
      max_tokens: 100,
    });

    expect(req.model).toBe('gpt-3.5-turbo');
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe('user');
    expect(req.messages[0].content).toBe('Hello world');
    expect(req.max_tokens).toBe(100);
  });

  it('throws when model is missing', () => {
    expect(() => normalizeRequest({
      messages: [{ role: 'user', content: 'Hello' }],
    })).toThrow('Missing or invalid "model"');
  });

  it('throws when model is not a string', () => {
    expect(() => normalizeRequest({
      model: 123,
      messages: [{ role: 'user', content: 'Hello' }],
    })).toThrow('Missing or invalid "model"');
  });

  it('throws when neither messages nor prompt is provided', () => {
    expect(() => normalizeRequest({
      model: 'gpt-4o',
    })).toThrow('messages');
  });

  it('passes through extra fields', () => {
    const req = normalizeRequest({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
      response_format: { type: 'json_object' },
      tools: [{ type: 'function', function: { name: 'test' } }],
    });

    expect((req as Record<string, unknown>).response_format).toEqual({ type: 'json_object' });
    expect((req as Record<string, unknown>).tools).toBeDefined();
  });
});

describe('extractFreeportMetadata', () => {
  it('extracts from freeport namespace', () => {
    const meta = extractFreeportMetadata({
      model: 'gpt-4o',
      freeport: {
        project_id: 'proj-1',
        prompt: 'my-prompt',
        prompt_version: 2,
        variables: { name: 'test' },
        ab_test: 'test-1',
        cache: 'no-cache',
      },
    });

    expect(meta.projectId).toBe('proj-1');
    expect(meta.promptSlug).toBe('my-prompt');
    expect(meta.promptVersion).toBe(2);
    expect(meta.promptVariables).toEqual({ name: 'test' });
    expect(meta.abTestId).toBe('test-1');
    expect(meta.cacheControl).toBe('no-cache');
  });

  it('falls back to metadata namespace', () => {
    const meta = extractFreeportMetadata({
      model: 'gpt-4o',
      metadata: { project_id: 'proj-2' },
    });
    expect(meta.projectId).toBe('proj-2');
  });

  it('returns empty object when no metadata', () => {
    const meta = extractFreeportMetadata({ model: 'gpt-4o' });
    expect(meta).toEqual({});
  });
});

describe('extractPromptText', () => {
  it('concatenates messages', () => {
    const text = extractPromptText([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi there' },
    ]);
    expect(text).toContain('system: You are helpful.');
    expect(text).toContain('user: Hi there');
  });
});
