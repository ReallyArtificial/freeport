import type { GuardrailPlugin, GuardrailResult } from '../engine.js';

const PII_PATTERNS = [
  {
    name: 'SSN',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[SSN REDACTED]',
  },
  {
    name: 'Credit Card',
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    replacement: '[CC REDACTED]',
  },
  {
    name: 'Email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: '[EMAIL REDACTED]',
  },
  {
    name: 'Phone',
    pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: '[PHONE REDACTED]',
  },
];

function detectPII(text: string): Array<{ type: string; match: string; index: number }> {
  const findings: Array<{ type: string; match: string; index: number }> = [];

  for (const { name, pattern } of PII_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      findings.push({ type: name, match: match[0], index: match.index });
    }
  }

  return findings;
}

function redactPII(text: string): string {
  let redacted = text;
  for (const { pattern, replacement } of PII_PATTERNS) {
    redacted = redacted.replace(new RegExp(pattern.source, pattern.flags), replacement);
  }
  return redacted;
}

export const piiDetectorPlugin: GuardrailPlugin = {
  name: 'pii-detector',

  checkInput(text: string): GuardrailResult {
    const findings = detectPII(text);
    if (findings.length === 0) {
      return { passed: true, guardrail: 'pii-detector' };
    }

    const redacted = redactPII(text);
    return {
      passed: false,
      guardrail: 'pii-detector',
      message: `PII detected: ${findings.map(f => f.type).join(', ')}`,
      details: findings.map(f => ({ type: f.type, index: f.index })),
      modified: redacted,
    };
  },

  checkOutput(text: string): GuardrailResult {
    const findings = detectPII(text);
    if (findings.length === 0) {
      return { passed: true, guardrail: 'pii-detector' };
    }

    const redacted = redactPII(text);
    return {
      passed: true, // Allow but redact
      guardrail: 'pii-detector',
      message: `PII redacted from output: ${findings.map(f => f.type).join(', ')}`,
      details: findings.map(f => ({ type: f.type })),
      modified: redacted,
    };
  },
};
