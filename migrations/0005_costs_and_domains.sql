-- Costs: deleted files keep their row (with deleted_at) so past months' storage can still be added up.
ALTER TABLE files ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS files_live ON files (user_id, deleted_at);

-- A friend's own domain, if it's registered and paid for through RFR. Archie fills these in at /admin.
ALTER TABLE users ADD COLUMN domain TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN domain_cost_cents INTEGER NOT NULL DEFAULT 0; -- per year
ALTER TABLE users ADD COLUMN domain_since TEXT NOT NULL DEFAULT '';      -- YYYY-MM-DD it was first paid for; renews yearly
