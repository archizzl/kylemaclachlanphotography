-- Agent keys: a friend can let an AI agent (or a script) use the dashboard API as them, without
-- sharing their password. Only the key's SHA-256 is stored; the key itself is shown once.
CREATE TABLE IF NOT EXISTS agent_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS agent_keys_user ON agent_keys (user_id);
