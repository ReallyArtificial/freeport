/** Per-token pricing in USD (per 1M tokens) */
interface ModelPricing {
  input: number;   // per 1M input tokens
  output: number;  // per 1M output tokens
}

const PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'o1': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 3.00, output: 12.00 },
  'o3-mini': { input: 1.10, output: 4.40 },

  // Anthropic
  'claude-sonnet-4-5-20250929': { input: 3.00, output: 15.00 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
  'claude-opus-4-6': { input: 15.00, output: 75.00 },

  // Google
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
};

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[model];
  if (!pricing) {
    // Default conservative pricing
    return (inputTokens * 5 + outputTokens * 15) / 1_000_000;
  }

  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export function getModelPricing(model: string): ModelPricing | undefined {
  return PRICING[model];
}

export function getAllPricing(): Record<string, ModelPricing> {
  return { ...PRICING };
}
