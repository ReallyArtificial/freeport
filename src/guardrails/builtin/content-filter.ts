import type { GuardrailPlugin, GuardrailResult } from '../engine.js';

/**
 * Basic content filter for output safety.
 * Checks for potentially harmful content patterns.
 * This is a lightweight heuristic - not a replacement for dedicated safety APIs.
 */

const HARMFUL_PATTERNS = [
  /how to (?:make|build|create) (?:a )?(?:bomb|explosive|weapon)/i,
  /instructions (?:for|to) (?:hack|attack|exploit)/i,
  /(?:synthesize|manufacture) (?:drugs|narcotics|meth)/i,
];

export const contentFilterPlugin: GuardrailPlugin = {
  name: 'content-filter',

  checkOutput(text: string): GuardrailResult {
    for (const pattern of HARMFUL_PATTERNS) {
      if (pattern.test(text)) {
        return {
          passed: false,
          guardrail: 'content-filter',
          message: 'Content filter triggered: potentially harmful content detected in output',
        };
      }
    }

    return { passed: true, guardrail: 'content-filter' };
  },
};
