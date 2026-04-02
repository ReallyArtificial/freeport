import { getLogger } from '../logging/logger.js';
import { createHash } from 'node:crypto';

type EmbedFn = (text: string | string[]) => Promise<{ data: Float32Array[] | Float32Array }>;

let pipeline: EmbedFn | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the local embedding model.
 * Uses @huggingface/transformers with all-MiniLM-L6-v2 for 384-dim embeddings.
 */
export async function initEmbedder(): Promise<void> {
  if (pipeline) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const log = getLogger();
    try {
      // Dynamic import — @huggingface/transformers is an optional dependency
      const mod = await import(/* webpackIgnore: true */ '@huggingface/transformers' as string);
      const createPipeline = mod.pipeline ?? mod.default?.pipeline;
      if (!createPipeline) throw new Error('@huggingface/transformers pipeline not found');

      const pipe = await createPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        dtype: 'fp32',
      });

      pipeline = async (text: string | string[]) => {
        const output = await pipe(text, { pooling: 'mean', normalize: true });
        return { data: Array.isArray(text) ? output.tolist() : [output.tolist()[0]] };
      };

      log.info('Embedding model loaded: all-MiniLM-L6-v2');
    } catch (err) {
      log.warn({ err }, 'Failed to load embedding model. Semantic cache will use hash-based fallback.');
      pipeline = null;
    }
  })();

  return initPromise;
}

/**
 * Generate embedding for text.
 * Returns 384-dimensional float array.
 * Falls back to hash-based pseudo-embedding if model isn't loaded.
 */
export async function embed(text: string): Promise<Float32Array> {
  if (pipeline) {
    const result = await pipeline(text);
    const data = result.data;
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      return first instanceof Float32Array ? first : new Float32Array(first as number[]);
    }
    return data instanceof Float32Array ? data : new Float32Array(data as unknown as number[]);
  }

  // Fallback: generate a deterministic hash-based vector
  return hashEmbed(text);
}

function hashEmbed(text: string): Float32Array {
  const hash = createHash('sha256').update(text).digest();
  const vec = new Float32Array(384);
  for (let i = 0; i < 384; i++) {
    vec[i] = (hash[i % 32] / 255) * 2 - 1;
  }
  return vec;
}

export function promptHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function isEmbedderReady(): boolean {
  return pipeline !== null;
}
