import { describe, it, expect } from 'vitest';
import { getMessageText } from '../src/providers/base.js';
import type { ChatMessage, ContentPart } from '../src/providers/base.js';
import { extractPromptText } from '../src/proxy/transformer.js';
import { countMessageTokens } from '../src/utils/tokens.js';

describe('getMessageText', () => {
  it('returns string content verbatim', () => {
    expect(getMessageText({ role: 'user', content: 'hello world' })).toBe('hello world');
  });

  it('returns empty string for null content (tool-only messages)', () => {
    expect(getMessageText({ role: 'assistant', content: null })).toBe('');
  });

  it('joins text parts and flattens images to [image]', () => {
    const content: ContentPart[] = [
      { type: 'text', text: 'describe ' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      { type: 'text', text: ' this' },
    ];
    expect(getMessageText({ role: 'user', content })).toBe('describe [image] this');
  });

  it('preserves order: text then image', () => {
    const content: ContentPart[] = [
      { type: 'text', text: 'before' },
      { type: 'image_url', image_url: { url: 'http://x/y.png' } },
    ];
    expect(getMessageText({ role: 'user', content })).toBe('before[image]');
  });

  it('image-then-text order is preserved', () => {
    const content: ContentPart[] = [
      { type: 'image_url', image_url: { url: 'http://x/y.png' } },
      { type: 'text', text: 'describe this' },
    ];
    expect(getMessageText({ role: 'user', content })).toBe('[image]describe this');
  });

  it('is deterministic — same input yields identical output across calls', () => {
    const content: ContentPart[] = [
      { type: 'text', text: 'a' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,ZZZZ' } },
      { type: 'text', text: 'b' },
    ];
    const msg: ChatMessage = { role: 'user', content };
    const first = getMessageText(msg);
    const second = getMessageText(msg);
    expect(first).toBe(second);
    expect(first).toBe('a[image]b');
    // The flattened key never bloats with base64 payload.
    expect(first).not.toContain('ZZZZ');
  });

  it('does not include base64 image payload in the flattened text', () => {
    const content: ContentPart[] = [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,VERYLONGBASE64DATA' } },
    ];
    expect(getMessageText({ role: 'user', content })).toBe('[image]');
  });
});

describe('extractPromptText with multimodal content', () => {
  it('flattens a multimodal user message through getMessageText', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          { type: 'text', text: 'describe this' },
        ],
      },
    ];
    expect(extractPromptText(messages)).toBe('user: [image]describe this');
  });

  it('keeps string content unchanged', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ];
    expect(extractPromptText(messages)).toBe('system: be terse\nuser: hi');
  });
});

describe('countMessageTokens with ContentPart[] content', () => {
  it('does not throw and counts the flattened text', () => {
    const messages: Array<{ role: string; content: string | ContentPart[] | null }> = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ],
      },
    ];
    // Flattened = "hello[image]" (12 chars). Should equal the count for that string.
    const arrayCount = countMessageTokens(messages);
    const stringCount = countMessageTokens([{ role: 'user', content: 'hello[image]' }]);
    expect(arrayCount).toBe(stringCount);
  });

  it('image part adds only the [image] placeholder length, not base64', () => {
    const withImage = countMessageTokens([
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'X'.repeat(5000) } }],
      },
    ]);
    const placeholderOnly = countMessageTokens([{ role: 'user', content: '[image]' }]);
    expect(withImage).toBe(placeholderOnly);
  });

  it('handles null content', () => {
    expect(() => countMessageTokens([{ role: 'assistant', content: null }])).not.toThrow();
  });
});
