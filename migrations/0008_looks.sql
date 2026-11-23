-- Each blog's look from the style tab, so other blogs can start from it. It never styles anyone's
-- site by itself: the CSS is still copied and pasted.
ALTER TABLE users ADD COLUMN look_json TEXT NOT NULL DEFAULT '';
