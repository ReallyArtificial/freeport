/**
 * Approximate token counting.
 * Uses the ~4 chars per token heuristic for English text.
 * For production accuracy, consider tiktoken, but this avoids the heavy WASM dependency.
 */
export function estimateTokens(text: string): number {
  // GPT tokenizers average ~4 chars per token for English
  return Math.ceil(text.length / 4);
}

export function countMessageTokens(messages: Array<{ role: string; content: string | null }>): number {
  let total = 0;
  for (const msg of messages) {
    // ~4 tokens per message overhead (role, formatting)
    total += 4;
    if (msg.content) {
      total += estimateTokens(msg.content);
    }
  }
  // Every reply is primed with <|start|>assistant<|message|>
  total += 3;
  return total;
}
