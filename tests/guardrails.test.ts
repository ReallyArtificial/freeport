import { describe, it, expect, beforeEach, vi } from 'vitest';

import { piiDetectorPlugin } from '../src/guardrails/builtin/pii-detector.js';
import { contentFilterPlugin } from '../src/guardrails/builtin/content-filter.js';
import { createTokenLimitPlugin } from '../src/guardrails/builtin/token-limit.js';

// ---------------------------------------------------------------------------
// 1. PII Detector
// ---------------------------------------------------------------------------
describe('PII Detector Plugin', () => {
  // -- checkInput -----------------------------------------------------------
  describe('checkInput', () => {
    it('passes clean text with no PII', () => {
      const result = piiDetectorPlugin.checkInput!('Hello, how are you today?');
      expect(result.passed).toBe(true);
      expect(result.guardrail).toBe('pii-detector');
      expect(result.modified).toBeUndefined();
    });

    it('detects and redacts SSN', () => {
      const result = piiDetectorPlugin.checkInput!('My SSN is 123-45-6789');
      expect(result.passed).toBe(false);
      expect(result.guardrail).toBe('pii-detector');
      expect(result.message).toContain('SSN');
      expect(result.modified).toBe('My SSN is [SSN REDACTED]');
    });

    it('detects and redacts credit card numbers', () => {
      const result = piiDetectorPlugin.checkInput!('Card: 4111 1111 1111 1111');
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Credit Card');
      expect(result.modified).toBe('Card: [CC REDACTED]');
    });

    it('detects credit card numbers without spaces', () => {
      const result = piiDetectorPlugin.checkInput!('Card: 4111111111111111');
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Credit Card');
      expect(result.modified).toBe('Card: [CC REDACTED]');
    });

    it('detects credit card numbers with dashes', () => {
      const result = piiDetectorPlugin.checkInput!('Card: 4111-1111-1111-1111');
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Credit Card');
      expect(result.modified).toBe('Card: [CC REDACTED]');
    });

    it('detects and redacts email addresses', () => {
      const result = piiDetectorPlugin.checkInput!('Email me at user@example.com please');
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Email');
      expect(result.modified).toBe('Email me at [EMAIL REDACTED] please');
    });

    it('detects and redacts US phone numbers', () => {
      const result = piiDetectorPlugin.checkInput!('Call me at (555) 123-4567');
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Phone');
      expect(result.modified).toBe('Call me at ([PHONE REDACTED]');
    });

    it('detects phone numbers with +1 prefix', () => {
      const result = piiDetectorPlugin.checkInput!('Call +1-555-123-4567 now');
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Phone');
      expect(result.modified).toContain('[PHONE REDACTED]');
    });

    it('detects multiple PII types in a single input', () => {
      const text = 'SSN: 111-22-3333, email: a@b.com, phone: 555-111-2222';
      const result = piiDetectorPlugin.checkInput!(text);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('SSN');
      expect(result.message).toContain('Email');
      expect(result.message).toContain('Phone');
      expect(result.modified).toContain('[SSN REDACTED]');
      expect(result.modified).toContain('[EMAIL REDACTED]');
      expect(result.modified).toContain('[PHONE REDACTED]');
    });

    it('includes detail entries with type and index for each finding', () => {
      const result = piiDetectorPlugin.checkInput!('SSN: 111-22-3333');
      expect(result.passed).toBe(false);
      expect(Array.isArray(result.details)).toBe(true);
      const details = result.details as Array<{ type: string; index: number }>;
      expect(details.length).toBeGreaterThanOrEqual(1);
      expect(details[0].type).toBe('SSN');
      expect(typeof details[0].index).toBe('number');
    });
  });

  // -- checkOutput ----------------------------------------------------------
  describe('checkOutput', () => {
    it('passes clean output text', () => {
      const result = piiDetectorPlugin.checkOutput!('The weather is nice.');
      expect(result.passed).toBe(true);
      expect(result.guardrail).toBe('pii-detector');
      expect(result.modified).toBeUndefined();
    });

    it('passes output but still redacts SSN found in output', () => {
      const result = piiDetectorPlugin.checkOutput!('Your SSN is 123-45-6789');
      expect(result.passed).toBe(true);
      expect(result.modified).toBe('Your SSN is [SSN REDACTED]');
      expect(result.message).toContain('PII redacted from output');
    });

    it('passes output but redacts email found in output', () => {
      const result = piiDetectorPlugin.checkOutput!('Contact admin@corp.org for help');
      expect(result.passed).toBe(true);
      expect(result.modified).toBe('Contact [EMAIL REDACTED] for help');
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Content Filter
// ---------------------------------------------------------------------------
describe('Content Filter Plugin', () => {
  it('does not expose a checkInput method', () => {
    expect(contentFilterPlugin.checkInput).toBeUndefined();
  });

  describe('checkOutput', () => {
    it('passes safe content', () => {
      const result = contentFilterPlugin.checkOutput!('Here is a summary of the article.');
      expect(result.passed).toBe(true);
      expect(result.guardrail).toBe('content-filter');
    });

    it('blocks output containing bomb-making instructions', () => {
      const result = contentFilterPlugin.checkOutput!('Here is how to make a bomb at home');
      expect(result.passed).toBe(false);
      expect(result.guardrail).toBe('content-filter');
      expect(result.message).toContain('harmful content');
    });

    it('blocks output containing hacking instructions', () => {
      const result = contentFilterPlugin.checkOutput!('Follow these instructions to hack a server');
      expect(result.passed).toBe(false);
      expect(result.message).toContain('harmful content');
    });

    it('blocks output about synthesizing drugs', () => {
      const result = contentFilterPlugin.checkOutput!('You can synthesize drugs by following these steps');
      expect(result.passed).toBe(false);
    });

    it('is case-insensitive', () => {
      const result = contentFilterPlugin.checkOutput!('HOW TO MAKE A BOMB');
      expect(result.passed).toBe(false);
    });

    it('passes content with unrelated keywords', () => {
      const result = contentFilterPlugin.checkOutput!(
        'The bomb squad safely detonated the suspicious package.',
      );
      expect(result.passed).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Token Limit
// ---------------------------------------------------------------------------
describe('Token Limit Plugin', () => {
  it('does not expose a checkOutput method', () => {
    const plugin = createTokenLimitPlugin(100);
    expect(plugin.checkOutput).toBeUndefined();
  });

  it('passes input under the token limit', () => {
    // 20 chars -> ~5 tokens (ceil(20/4))
    const plugin = createTokenLimitPlugin(10);
    const result = plugin.checkInput!('Hello world test txt');
    expect(result.passed).toBe(true);
    expect(result.guardrail).toBe('token-limit');
  });

  it('fails input exceeding the token limit', () => {
    // 20 chars -> ceil(20/4) = 5 tokens; limit = 4
    const plugin = createTokenLimitPlugin(4);
    const result = plugin.checkInput!('Hello world test txt');
    expect(result.passed).toBe(false);
    expect(result.guardrail).toBe('token-limit');
    expect(result.message).toContain('exceeds token limit');
    expect(result.message).toContain('5');
    expect(result.message).toContain('4');
  });

  it('passes input exactly at the token limit', () => {
    // 8 chars -> ceil(8/4) = 2 tokens; limit = 2
    const plugin = createTokenLimitPlugin(2);
    const result = plugin.checkInput!('abcdefgh');
    expect(result.passed).toBe(true);
  });

  it('includes estimated and max tokens in details on failure', () => {
    const plugin = createTokenLimitPlugin(1);
    const result = plugin.checkInput!('a long sentence that exceeds one token');
    expect(result.passed).toBe(false);
    const details = result.details as { estimatedTokens: number; maxTokens: number };
    expect(details.maxTokens).toBe(1);
    expect(details.estimatedTokens).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Guardrail Engine
// ---------------------------------------------------------------------------
describe('Guardrail Engine', () => {
  // Because the engine keeps module-level state (plugins array) we re-import
  // a fresh copy of the module for each test to avoid cross-contamination.
  let registerPlugin: typeof import('../src/guardrails/engine.js')['registerPlugin'];
  let runInputGuardrails: typeof import('../src/guardrails/engine.js')['runInputGuardrails'];
  let runOutputGuardrails: typeof import('../src/guardrails/engine.js')['runOutputGuardrails'];

  beforeEach(async () => {
    vi.resetModules();
    const engine = await import('../src/guardrails/engine.js');
    registerPlugin = engine.registerPlugin;
    runInputGuardrails = engine.runInputGuardrails;
    runOutputGuardrails = engine.runOutputGuardrails;
  });

  it('returns passed when no plugins are registered (input)', () => {
    const out = runInputGuardrails('anything');
    expect(out.passed).toBe(true);
    expect(out.results).toHaveLength(0);
    expect(out.modifiedText).toBe('anything');
  });

  it('returns passed when no plugins are registered (output)', () => {
    const out = runOutputGuardrails('anything');
    expect(out.passed).toBe(true);
    expect(out.results).toHaveLength(0);
    expect(out.modifiedText).toBe('anything');
  });

  it('runs a passing input plugin', () => {
    registerPlugin({
      name: 'pass-through',
      checkInput: (text) => ({ passed: true, guardrail: 'pass-through' }),
    });

    const out = runInputGuardrails('hello');
    expect(out.passed).toBe(true);
    expect(out.results).toHaveLength(1);
    expect(out.modifiedText).toBe('hello');
  });

  it('stops input chain when a plugin fails', () => {
    const secondCheckInput = vi.fn();

    registerPlugin({
      name: 'blocker',
      checkInput: () => ({ passed: false, guardrail: 'blocker', message: 'blocked' }),
    });
    registerPlugin({
      name: 'never-reached',
      checkInput: secondCheckInput,
    });

    const out = runInputGuardrails('test');
    expect(out.passed).toBe(false);
    expect(out.results).toHaveLength(1);
    expect(out.results[0].guardrail).toBe('blocker');
    expect(secondCheckInput).not.toHaveBeenCalled();
  });

  it('propagates modified text through the input chain', () => {
    registerPlugin({
      name: 'uppercaser',
      checkInput: (text) => ({
        passed: true,
        guardrail: 'uppercaser',
        modified: text.toUpperCase(),
      }),
    });
    registerPlugin({
      name: 'exclaimer',
      checkInput: (text) => ({
        passed: true,
        guardrail: 'exclaimer',
        modified: text + '!',
      }),
    });

    const out = runInputGuardrails('hello');
    expect(out.passed).toBe(true);
    expect(out.modifiedText).toBe('HELLO!');
    expect(out.results).toHaveLength(2);
  });

  it('skips plugins without checkInput during input guardrails', () => {
    registerPlugin({
      name: 'output-only',
      checkOutput: () => ({ passed: true, guardrail: 'output-only' }),
    });

    const out = runInputGuardrails('test');
    expect(out.passed).toBe(true);
    expect(out.results).toHaveLength(0);
  });

  it('stops output chain when a plugin fails', () => {
    registerPlugin({
      name: 'content-blocker',
      checkOutput: () => ({
        passed: false,
        guardrail: 'content-blocker',
        message: 'bad output',
      }),
    });

    const out = runOutputGuardrails('harmful text');
    expect(out.passed).toBe(false);
    expect(out.results).toHaveLength(1);
  });

  it('propagates modified text through the output chain', () => {
    registerPlugin({
      name: 'redactor',
      checkOutput: (text) => ({
        passed: true,
        guardrail: 'redactor',
        modified: text.replace('secret', '***'),
      }),
    });
    registerPlugin({
      name: 'trimmer',
      checkOutput: (text) => ({
        passed: true,
        guardrail: 'trimmer',
        modified: text.trim(),
      }),
    });

    const out = runOutputGuardrails('  the secret code  ');
    expect(out.passed).toBe(true);
    expect(out.modifiedText).toBe('the *** code');
    expect(out.results).toHaveLength(2);
  });

  it('returns unmodified text when failing plugin provides no modified field', () => {
    registerPlugin({
      name: 'hard-fail',
      checkInput: () => ({
        passed: false,
        guardrail: 'hard-fail',
        message: 'nope',
      }),
    });

    const out = runInputGuardrails('original');
    expect(out.passed).toBe(false);
    expect(out.modifiedText).toBe('original');
  });

  it('collects results from all passing plugins', () => {
    registerPlugin({
      name: 'a',
      checkOutput: () => ({ passed: true, guardrail: 'a' }),
    });
    registerPlugin({
      name: 'b',
      checkOutput: () => ({ passed: true, guardrail: 'b' }),
    });
    registerPlugin({
      name: 'c',
      checkOutput: () => ({ passed: true, guardrail: 'c' }),
    });

    const out = runOutputGuardrails('text');
    expect(out.passed).toBe(true);
    expect(out.results).toHaveLength(3);
    expect(out.results.map((r) => r.guardrail)).toEqual(['a', 'b', 'c']);
  });
});
