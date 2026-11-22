-- Three wrong passwords in a row lock an account until Archie sets a new password at /admin.
ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_at TEXT;
