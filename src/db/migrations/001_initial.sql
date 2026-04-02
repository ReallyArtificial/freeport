-- Core tables for Freeport

-- Projects for budget/tracking isolation
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  budget_limit REAL,
  budget_spent REAL DEFAULT 0,
  budget_reset_at TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- API keys for authenticating proxy requests
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  rate_limit_rpm INTEGER,
  rate_limit_tpm INTEGER,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  last_used_at TEXT
);

-- Provider keys (encrypted at rest in Phase 8)
CREATE TABLE IF NOT EXISTS provider_keys (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  provider_name TEXT NOT NULL,
  api_key TEXT NOT NULL,
  weight REAL DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  total_requests INTEGER DEFAULT 0,
  total_errors INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Request/response logs
CREATE TABLE IF NOT EXISTS request_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT REFERENCES projects(id),
  api_key_id TEXT REFERENCES api_keys(id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  request_body TEXT,
  response_body TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  status_code INTEGER,
  is_cached INTEGER DEFAULT 0,
  is_fallback INTEGER DEFAULT 0,
  error TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_request_logs_project ON request_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_created ON request_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_model ON request_logs(model);

-- Budget tracking
CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  project_id TEXT REFERENCES projects(id) UNIQUE,
  monthly_limit REAL,
  daily_limit REAL,
  monthly_spent REAL DEFAULT 0,
  daily_spent REAL DEFAULT 0,
  monthly_reset_at TEXT,
  daily_reset_at TEXT,
  is_killed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
);
