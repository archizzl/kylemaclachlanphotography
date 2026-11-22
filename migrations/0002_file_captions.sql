-- Alt text and captions for files, used by image embeds.
ALTER TABLE files ADD COLUMN alt TEXT NOT NULL DEFAULT '';
ALTER TABLE files ADD COLUMN caption TEXT NOT NULL DEFAULT '';
