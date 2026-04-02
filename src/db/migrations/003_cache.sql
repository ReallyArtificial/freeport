-- Semantic cache tables

CREATE TABLE IF NOT EXISTS cache_entries (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  model TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  response_text TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  hit_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  last_hit_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_cache_model ON cache_entries(model);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache_entries(expires_at);
CREATE INDEX IF NOT EXISTS idx_cache_prompt_hash ON cache_entries(prompt_hash);

-- Note: The vector table (cache_vectors) will be created at runtime
-- when sqlite-vec extension is loaded, using:
-- CREATE VIRTUAL TABLE IF NOT EXISTS cache_vectors USING vec0(
--   id TEXT PRIMARY KEY,
--   embedding FLOAT[384]
-- );
