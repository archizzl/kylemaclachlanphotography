-- Friends' accounts, their posts and their uploaded files.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,         -- lowercase, used in URLs
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,           -- pbkdf2$<iterations>$<salt>$<hash>
  site_url TEXT NOT NULL DEFAULT '',     -- the friend's own site
  post_url_pattern TEXT NOT NULL DEFAULT '', -- e.g. https://maya.neocities.org/blog/{slug}, for feed links
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,                    -- YYYY-MM-DD shown on the post
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, slug)
);
CREATE INDEX IF NOT EXISTS posts_user_published ON posts (user_id, published, date DESC);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL UNIQUE,              -- R2 key: <username>/<name>
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS files_user ON files (user_id, created_at DESC);

-- Wrong-password counter for both login forms, per IP.
CREATE TABLE IF NOT EXISTS login_fails (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
