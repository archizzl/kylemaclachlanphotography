-- Cloudflare's own daily R2 measurements for every bucket on the account (see src/r2usage.js).
-- Cloudflare keeps only ~13 weeks, so these are copied here daily and kept.
CREATE TABLE IF NOT EXISTS r2_usage_daily (
  date TEXT NOT NULL,                     -- YYYY-MM-DD (UTC)
  bucket TEXT NOT NULL,
  stored_bytes INTEGER NOT NULL DEFAULT 0, -- that day's peak, objects + metadata
  class_a INTEGER NOT NULL DEFAULT 0,     -- writes and lists
  class_b INTEGER NOT NULL DEFAULT 0,     -- reads
  synced_at TEXT NOT NULL,
  PRIMARY KEY (date, bucket)
);

-- Small bits of state, e.g. how the last usage sync went.
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
