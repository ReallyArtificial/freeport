import type { GuardrailPlugin, GuardrailResult } from '../engine.js';
import { estimateTokens } from '../../utils/tokens.js';

export function createTokenLimitPlugin(maxTokens: number): GuardrailPlugin {
  return {
    name: 'token-limit',

    checkInput(text: string): GuardrailResult {
      const tokens = estimateTokens(text);
      if (tokens > maxTokens) {
        return {
          passed: false,
          guardrail: 'token-limit',
          message: `Input exceeds token limit: ~${tokens} tokens (max: ${maxTokens})`,
          details: { estimatedTokens: tokens, maxTokens },
        };
      }

      return { passed: true, guardrail: 'token-limit' };
    },
  };
}
