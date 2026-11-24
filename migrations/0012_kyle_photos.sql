-- The photos of Kyle MacLachlan that the front page cycles through. Accepting a sign-up adds its
-- photo; Archie can also add and remove photos at /admin. Files are in the bucket at _kyle/.
CREATE TABLE kyle_photos (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  width INTEGER,
  height INTEGER,
  credit TEXT NOT NULL DEFAULT '',   -- the first name of whoever picked it, if anyone
  signup_id INTEGER,
  created_at TEXT NOT NULL
);
INSERT INTO kyle_photos (key, width, height, credit, signup_id, created_at)
  SELECT photo_key, photo_width, photo_height, first_name, id, COALESCE(decided_at, created_at)
  FROM signups WHERE status = 'accepted' ORDER BY decided_at, id;
