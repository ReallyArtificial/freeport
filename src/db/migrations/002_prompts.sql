-- Prompt management tables

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  temperature REAL,
  max_tokens INTEGER,
  system_prompt TEXT,
  variables TEXT, -- JSON array of variable names
  tag TEXT DEFAULT 'draft' CHECK(tag IN ('draft', 'published', 'archived')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(prompt_id, version)
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt ON prompt_versions(prompt_id);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_tag ON prompt_versions(tag);
