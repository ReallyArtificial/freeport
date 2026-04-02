import { RateLimitError } from '../utils/errors.js';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number; // tokens per second
}

const buckets = new Map<string, TokenBucket>();
const MAX_BUCKETS = 100_000;

function getOrCreateBucket(key: string, maxTokens: number, refillPerSecond: number): TokenBucket {
  let bucket = buckets.get(key);
  if (!bucket) {
    // Prevent unbounded memory growth from unique keys
    if (buckets.size >= MAX_BUCKETS) {
      cleanupBuckets();
      // If still over limit after cleanup, evict oldest entry
      if (buckets.size >= MAX_BUCKETS) {
        const firstKey = buckets.keys().next().value;
        if (firstKey !== undefined) buckets.delete(firstKey);
      }
    }
    bucket = {
      tokens: maxTokens,
      lastRefill: Date.now(),
      maxTokens,
      refillRate: refillPerSecond,
    };
    buckets.set(key, bucket);
  }
  return bucket;
}

function refillBucket(bucket: TokenBucket): void {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsed * bucket.refillRate);
  bucket.lastRefill = now;
}

export function checkRateLimit(
  key: string,
  requestsPerMinute: number,
  tokensRequested: number = 1,
): void {
  const maxTokens = requestsPerMinute;
  const refillPerSecond = requestsPerMinute / 60;

  const bucket = getOrCreateBucket(key, maxTokens, refillPerSecond);
  refillBucket(bucket);

  if (bucket.tokens < tokensRequested) {
    const retryAfter = Math.ceil((tokensRequested - bucket.tokens) / bucket.refillRate);
    throw new RateLimitError(
      `Rate limit exceeded. Retry after ${retryAfter}s. Limit: ${requestsPerMinute} requests/min.`
    );
  }

  bucket.tokens -= tokensRequested;
}

/** Clean up expired buckets periodically */
export function cleanupBuckets(): void {
  const now = Date.now();
  const staleThreshold = 5 * 60 * 1000; // 5 minutes

  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefill > staleThreshold) {
      buckets.delete(key);
    }
  }
}

// Run cleanup every minute
setInterval(cleanupBuckets, 60_000).unref();
