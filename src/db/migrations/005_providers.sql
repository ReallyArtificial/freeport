-- Provider configurations managed via admin UI
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('openai', 'anthropic', 'google')),
  api_base TEXT,
  api_key TEXT NOT NULL,
  models TEXT, -- JSON array of model strings
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
