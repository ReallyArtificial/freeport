-- A/B testing tables

CREATE TABLE IF NOT EXISTS ab_tests (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'running', 'stopped', 'completed')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ab_test_variants (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  test_id TEXT NOT NULL REFERENCES ab_tests(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prompt_id TEXT REFERENCES prompts(id),
  model TEXT,
  weight REAL DEFAULT 0.5,
  config TEXT, -- JSON with additional overrides
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ab_test_results (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  test_id TEXT NOT NULL REFERENCES ab_tests(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES ab_test_variants(id) ON DELETE CASCADE,
  request_log_id TEXT REFERENCES request_logs(id),
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost REAL,
  user_rating INTEGER,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ab_results_test ON ab_test_results(test_id);
CREATE INDEX IF NOT EXISTS idx_ab_results_variant ON ab_test_results(variant_id);
