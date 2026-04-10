-- API key scopes and expiration
ALTER TABLE api_keys ADD COLUMN scopes TEXT DEFAULT '*';
ALTER TABLE api_keys ADD COLUMN expires_at TEXT;
