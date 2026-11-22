-- Each friend designs their own post fields (tags, numbers, text such as a location).
-- users.fields_json is the list of field definitions; posts.fields_json holds a post's values by field key.
ALTER TABLE users ADD COLUMN fields_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE posts ADD COLUMN fields_json TEXT NOT NULL DEFAULT '{}';
