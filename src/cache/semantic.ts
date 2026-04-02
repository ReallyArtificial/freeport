import { getDb } from '../db/connection.js';
import { embed, promptHash } from './embedder.js';
import { getLogger } from '../logging/logger.js';
import type { CacheConfig } from '../config/types.js';

let vecEnabled = false;

export interface CacheHit {
  id: string;
  responseText: string;
  inputTokens: number;
  outputTokens: number;
  similarity: number;
}

/** Initialize sqlite-vec extension for vector search */
export async function initVectorCache(): Promise<void> {
  const log = getLogger();
  const db = getDb();

  try {
    // Try to load sqlite-vec extension
    // The extension path varies by platform; try common locations
    try {
      db.loadExtension('vec0');
      vecEnabled = true;
    } catch {
      try {
        db.loadExtension('/usr/local/lib/vec0');
        vecEnabled = true;
      } catch {
        // sqlite-vec not available, use hash-based cache
        log.info('sqlite-vec not available, using exact-match cache fallback');
      }
    }

    if (vecEnabled) {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS cache_vectors USING vec0(
          id TEXT PRIMARY KEY,
          embedding FLOAT[384]
        );
      `);
      log.info('Vector cache table initialized');
    }
  } catch (err) {
    log.warn({ err }, 'Failed to initialize vector cache, using hash-based fallback');
    vecEnabled = false;
  }
}

/** Look up cache by semantic similarity or exact hash */
export async function cacheLookup(
  model: string,
  promptText: string,
  config: CacheConfig,
): Promise<CacheHit | null> {
  const log = getLogger();
  const db = getDb();
  const hash = promptHash(promptText);

  // Try exact hash match first (fast path)
  const exactMatch = db.prepare(`
    SELECT * FROM cache_entries
    WHERE prompt_hash = ? AND model = ?
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY created_at DESC LIMIT 1
  `).get(hash, model) as Record<string, unknown> | undefined;

  if (exactMatch) {
    // Update hit count
    db.prepare(`
      UPDATE cache_entries SET hit_count = hit_count + 1, last_hit_at = datetime('now')
      WHERE id = ?
    `).run(exactMatch.id);

    log.debug({ cacheId: exactMatch.id }, 'Exact cache hit');
    return {
      id: exactMatch.id as string,
      responseText: exactMatch.response_text as string,
      inputTokens: exactMatch.input_tokens as number,
      outputTokens: exactMatch.output_tokens as number,
      similarity: 1.0,
    };
  }

  // Try semantic similarity search if vec is available
  if (vecEnabled) {
    try {
      const embedding = await embed(promptText);
      const threshold = config.similarityThreshold ?? 0.95;

      const results = db.prepare(`
        SELECT cv.id, cv.distance, ce.*
        FROM cache_vectors cv
        JOIN cache_entries ce ON ce.id = cv.id
        WHERE ce.model = ?
          AND (ce.expires_at IS NULL OR ce.expires_at > datetime('now'))
        ORDER BY cv.embedding <-> ?
        LIMIT 1
      `).all(model, Buffer.from(embedding.buffer)) as Array<Record<string, unknown>>;

      if (results.length > 0) {
        const result = results[0];
        const distance = result.distance as number;
        // Convert L2 distance to cosine similarity (approximate)
        const similarity = 1 / (1 + distance);

        if (similarity >= threshold) {
          db.prepare(`
            UPDATE cache_entries SET hit_count = hit_count + 1, last_hit_at = datetime('now')
            WHERE id = ?
          `).run(result.id);

          log.debug({ cacheId: result.id, similarity }, 'Semantic cache hit');
          return {
            id: result.id as string,
            responseText: result.response_text as string,
            inputTokens: result.input_tokens as number,
            outputTokens: result.output_tokens as number,
            similarity,
          };
        }
      }
    } catch (err) {
      log.warn({ err }, 'Vector search failed');
    }
  }

  return null;
}

/** Store a response in the cache */
export async function cacheStore(
  model: string,
  promptText: string,
  responseText: string,
  inputTokens: number,
  outputTokens: number,
  config: CacheConfig,
): Promise<void> {
  const log = getLogger();
  const db = getDb();
  const hash = promptHash(promptText);
  const id = crypto.randomUUID().replace(/-/g, '');
  const ttl = config.ttlSeconds ?? 3600;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  try {
    db.prepare(`
      INSERT INTO cache_entries (id, model, prompt_hash, prompt_text, response_text,
        input_tokens, output_tokens, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, model, hash, promptText, responseText, inputTokens, outputTokens, expiresAt);

    // Store vector embedding if available
    if (vecEnabled) {
      const embedding = await embed(promptText);
      db.prepare(`
        INSERT INTO cache_vectors (id, embedding) VALUES (?, ?)
      `).run(id, Buffer.from(embedding.buffer));
    }

    // Evict if over max entries
    evictIfNeeded(config);

    log.debug({ cacheId: id }, 'Cached response');
  } catch (err) {
    log.warn({ err }, 'Failed to cache response');
  }
}

function evictIfNeeded(config: CacheConfig): void {
  const db = getDb();
  const maxEntries = config.maxEntries ?? 10000;

  const count = db.prepare('SELECT COUNT(*) as count FROM cache_entries').get() as { count: number };

  if (count.count > maxEntries) {
    const toDelete = count.count - maxEntries;
    // Delete oldest, least-hit entries
    db.prepare(`
      DELETE FROM cache_entries WHERE id IN (
        SELECT id FROM cache_entries ORDER BY last_hit_at ASC, created_at ASC LIMIT ?
      )
    `).run(toDelete);

    if (vecEnabled) {
      // Clean up orphaned vectors
      db.exec(`
        DELETE FROM cache_vectors WHERE id NOT IN (SELECT id FROM cache_entries)
      `);
    }
  }

  // Also clean expired entries
  db.prepare("DELETE FROM cache_entries WHERE expires_at < datetime('now')").run();
}

/** Clear all cache entries */
export function clearCache(): void {
  const db = getDb();
  db.exec('DELETE FROM cache_entries');
  if (vecEnabled) {
    db.exec('DELETE FROM cache_vectors');
  }
}
