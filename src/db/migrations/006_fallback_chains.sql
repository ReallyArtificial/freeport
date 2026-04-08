-- Fallback chains and runtime config

CREATE TABLE IF NOT EXISTS fallback_chains (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL UNIQUE,
  provider_order TEXT NOT NULL,  -- JSON array of provider names
  failure_threshold INTEGER DEFAULT 3,
  reset_timeout_ms INTEGER DEFAULT 60000,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runtime_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
