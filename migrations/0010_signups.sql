-- Sign-up requests from /signup. Archie accepts or denies each one at /admin. An accepted one
-- becomes a user, and its photo of Kyle MacLachlan joins the ones the front page cycles through.
CREATE TABLE signups (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  blog_name TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,          -- emptied once the request is decided
  photo_key TEXT NOT NULL,              -- in the FILES bucket: _kyle/<random>.<ext>
  photo_type TEXT NOT NULL,
  photo_size INTEGER NOT NULL,
  photo_width INTEGER,
  photo_height INTEGER,
  ip TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | denied
  created_at TEXT NOT NULL,
  decided_at TEXT,
  user_id INTEGER
);
CREATE INDEX signups_status ON signups (status, created_at);
ALTER TABLE users ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
