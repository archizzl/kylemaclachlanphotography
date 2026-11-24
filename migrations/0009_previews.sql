-- Preview sites: when a blog turns one on, this is its subdomain label (e.g. "brute-force" for
-- brute-force.kylemaclachlanphotography.org). NULL means off. It follows the blog's name.
ALTER TABLE users ADD COLUMN preview_host TEXT;
CREATE UNIQUE INDEX users_preview_host ON users (preview_host);
