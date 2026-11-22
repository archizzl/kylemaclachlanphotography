# Setting up a blog on kylemaclachlanphotography.org: a guide for AI agents

This site hosts blogs for a small group of friends. Each person writes posts and uploads photos here. Their own website (Squarespace, Neocities, a hand-made page, anything) shows that content through one-line embed codes, a JSON API or RSS.

You are probably here because someone asked you to **set up their blog to match a blog they already have**. That usually means:

- bringing their posts and photos over;
- recreating their tags, numbering and other details as post fields;
- giving them embed code and CSS that make it look like their existing site.

This guide covers all of it.

Base URL: `https://kylemaclachlanphotography.org`. All examples use it.

## Ground rules

- **Work as the person, for the person.** An agent key can create, publish and delete anything on their blog. Only do what they asked.
- **Ask before publishing.** Import as drafts (`"published": false`) unless they told you to publish. Show them what you made, then publish.
- **Never touch their existing site** unless they ask you to. Give them code to paste, or make the change only with their go-ahead.
- **Don't delete** posts, files or fields you didn't create in this session without asking.
- **Respect privacy.** Everything published here is public, and so is every uploaded file, even ones only used in drafts. Leave out anything they didn't want public.
- The person can't see what you did unless you tell them. End with a short summary: what you imported, what's a draft, what you changed, and anything you couldn't bring over.

## 1. Access

The person makes an **agent key** in their dashboard (settings → "let an AI agent set up your blog") and gives it to you, with their username. Send it on every API call:

```
Authorization: Bearer kmp_…
```

- The key works as that person on `/api/*`. It can't change their password or manage keys.
- They can revoke it at any time.
- If you get `401`, the key is wrong or revoked. Ask them for a new one.
- Don't ask for their password, and don't put the key in anything public.

Check it works:

```bash
curl -s https://kylemaclachlanphotography.org/api/me -H "Authorization: Bearer $KEY"
```

```json
{ "username": "maya", "display_name": "", "site_url": "", "post_url_pattern": "", "fields": [],
  "cdn": "https://cdn.kylemaclachlanphotography.org/maya/",
  "feeds": { "rss": "…/maya/feed.xml", "json": "…/maya/feed.json" } }
```

## 2. Study the existing blog

Read their current blog, and ask them about anything you can't see. Write down:

- **posts**: how many, their titles, dates, original URLs (slugs), and which are drafts or private;
- **per-post details**: tags or categories, numbering ("#12"), location, mood, series, anything else shown with each post;
- **how posts are listed**: newest first? by number? grouped by tag? Is there a filter menu?
- **images**: where they're hosted, their alt text and captions;
- **the look**: fonts, colors, spacing, how titles, dates and tags appear. Note the CSS where you can;
- **where posts live on their site**, e.g. `https://maya.neocities.org/blog/<slug>`. Feeds and list embeds link there.

## 3. Blog settings

```bash
curl -s -X PUT https://kylemaclachlanphotography.org/api/me -H "Authorization: Bearer $KEY" \
  -H "content-type: application/json" \
  -d '{"display_name":"maya'"'"'s notebook","site_url":"https://maya.neocities.org","post_url_pattern":"https://maya.neocities.org/blog/{slug}"}'
```

| field | meaning |
|---|---|
| `display_name` | The **blog's name**. It's shown in the front page's sidebar and as the feed title. |
| `site_url` | Their own site, `https://` only. |
| `post_url_pattern` | Where one post lives on their site. Must contain `{slug}`. Optional. |

The `PUT` replaces all three, so send all of them.

## 4. Post fields: their own tags, numbers and details

Each blog designs its own fields. There are up to **10**, of three kinds:

| kind | value on a post | use for | options |
|---|---|---|---|
| `tags` | a list of strings, chosen from `choices` | categories, emotions, series, topics | `choices`: up to 50 tags, in the order menus and groups show them |
| `number` | a number | issue or entry numbers, ratings, years | `auto: true`: new posts without a number get the highest so far + 1 |
| `text` | one line, up to 200 characters | location, mood, weather, a soundtrack | none |

```bash
curl -s -X PUT https://kylemaclachlanphotography.org/api/fields -H "Authorization: Bearer $KEY" \
  -H "content-type: application/json" -d '{"fields":[
    {"name":"emotion","kind":"tags","choices":["tender","restless","lonely","hopeful"]},
    {"name":"no.","kind":"number","auto":true},
    {"name":"written at","kind":"text"}
  ]}'
```

- The response gives each field a **`key`**: `emotion`, `no`, `written_at`. Keys are made from the name when the field is created, and never change. Use them in post values and embed codes.
- To rename a field, or change its choices, send the whole list again with each existing field's `key` included. A field you leave out is removed, and its values stop showing.
- A tag that isn't in `choices` is dropped when a post is saved. Set up every tag before importing.
- Map their existing structure onto this. For example, WordPress categories and tags become `tags` fields, and a "#12" in titles becomes a `number` field, with the number taken out of the title.

## 5. Photos and files

Upload the raw bytes, with the file name in the query string:

```bash
curl -s -X PUT "https://kylemaclachlanphotography.org/api/files?name=beach-day.jpg" -H "Authorization: Bearer $KEY" \
  -H "content-type: image/jpeg" -H "x-width: 2400" -H "x-height: 1800" --data-binary @beach-day.jpg
```

- The response is `{"file": {"id": 7, "name": "beach-day.jpg", "url": "https://cdn.kylemaclachlanphotography.org/maya/beach-day.jpg", …}}`. Use that `url` in posts.
- **Allowed**: JPEG, PNG, WebP, GIF, AVIF, PDF, `.md`, `.txt`. 25 MB at most.
- **Refused**: SVG, HTML and scripts, and any file whose contents don't match its extension.
- Names are cleaned up (`My Photo.JPG` → `my-photo.jpg`).
- A name that's already taken gets a random suffix. **Files are never overwritten**, so keep a map of old URL → new `url`.
- `x-width` and `x-height` are optional, but they help pages lay out before the image loads.
- Unlike the dashboard, the API doesn't shrink photos or strip their metadata. If you can, resize to 2400px on the long edge, and remove EXIF and GPS data before uploading.
- Describe each photo. Alt text is read aloud to people who can't see it, and the caption shows under it:

```bash
curl -s -X PUT https://kylemaclachlanphotography.org/api/files/7 -H "Authorization: Bearer $KEY" \
  -H "content-type: application/json" -d '{"alt":"maya'"'"'s dog asleep on a towel","caption":"rex, *snoring*"}'
```

Other file calls:

- `GET /api/files` lists their files.
- `DELETE /api/files/<id>` deletes one. Ask first.

## 6. Posts

```bash
curl -s -X POST https://kylemaclachlanphotography.org/api/posts -H "Authorization: Bearer $KEY" \
  -H "content-type: application/json" -d '{
    "title": "the bus is late again",
    "slug": "the-bus-is-late-again",
    "date": "2024-03-02",
    "body": "the bus is late again\nand we have all become philosophers\n\n![a pink evening sky](https://cdn.kylemaclachlanphotography.org/maya/sky.jpg)",
    "published": false,
    "fields": { "emotion": ["hopeful", "restless"], "no": 2, "written_at": "the 14 bus stop" }
  }'
```

| field | notes |
|---|---|
| `title` | Required. Up to 200 characters. |
| `slug` | The post's address. Keep their old slugs so links match. It's made from the title if left out. If it's taken, `-2`, `-3`… is added. `posts` and `feed` are reserved. |
| `date` | `YYYY-MM-DD`. Use the original date. If missing or invalid, today's date is used. |
| `body` | Markdown, up to 200,000 characters. See below. |
| `published` | `true` to publish now, `false` for a draft. |
| `fields` | Values keyed by field key, as set up in step 4. |

Other post calls:

- `GET /api/posts` lists posts without bodies.
- `GET /api/posts/<id>` returns one post, with its `body_md`.
- `PUT /api/posts/<id>` **replaces the whole post**. Send every property (`title`, `slug`, `date`, `body`, `published`, `fields`), not just the ones you're changing. A property you leave out is reset.
- `DELETE /api/posts/<id>` deletes it. Ask first.
- `POST /api/preview` with `{"body": "…"}` returns `{"html": "…"}`, rendered exactly as readers will see it.

### Writing the body

- The body is markdown (CommonMark, via markdown-it). It supports headings, **bold**, *italics*, links, lists, quotes, code, tables, ~~strikethrough~~ and images `![alt](url)`.
- **A single line break is kept.** Poems and addresses keep their shape. A blank line starts a new paragraph.
- **Raw HTML is shown as text, not run.** Convert HTML posts to markdown. `<iframe>`, `<script>`, inline styles and embeds won't work.
- Bare URLs become links. `javascript:` and similar links are removed.
- Replace every image URL with the uploaded file's `url` from step 5.

## 7. Show it on their site

Everything is inserted as plain HTML where the `<script>` tag sits, with no iframe. Their site's own CSS styles it.

```html
<!-- one post -->
<script src="https://kylemaclachlanphotography.org/embed.js" data-user="maya" data-post="the-bus-is-late-again" async></script>
<!-- a list of posts -->
<script src="https://kylemaclachlanphotography.org/embed.js" data-user="maya" data-list="20" async></script>
<!-- one photo, with its alt text and caption -->
<script src="https://kylemaclachlanphotography.org/embed.js" data-user="maya" data-image="beach-day.jpg" async></script>
```

| attribute | effect |
|---|---|
| `data-list="N"` | Show the latest N posts (up to 50). |
| `data-filter="emotion:tender"` | Only posts with that value. For several, separate with commas; a post must match all of them. |
| `data-sort="no"` | Order by a number or text field, or `date` for oldest first. Add `-` in front to reverse (`-no`). The default is newest first. |
| `data-group="emotion"` | Show a heading for each value (tags in their `choices` order), with its posts under it. |
| `data-menu="emotion"` | Add a labelled row of buttons that readers click to filter to one value. "all" is selected first. Each post's own tags for that field become clickable filters too. |
| `data-menu-label="filter by feeling"` | The words before those buttons. Defaults to the field's name. |
| `data-title="no"` | Hide post titles and dates. |
| `data-fields="no"` | Hide field values. |
| `data-caption="no"` | Hide photo captions. |
| `data-style="none"` | Turn off the few built-in default styles. |

These can be combined, for example a menu plus number order: `data-menu="emotion" data-sort="-no"`.

**Keep the reader's choices simple.** The usual pattern is a single list in the blog's natural order (newest first, the default), with one labelled filter row (`data-menu`). Don't give readers a second toggle for "views" unless their old blog had one. Use `data-group` for a page that is *meant* to be an index by category, such as an archive page.

### Styling it to match

The built-in defaults use `:where()`, so they have no specificity, and they load first. Any rule on the site wins over them. These are the hooks:

```css
.kmp-embed {}                          /* wrapper inserted after each script tag */
.kmp-post {}                           /* one post (an <article>) */
.kmp-post[data-emotion~="tender"] {}   /* posts carry tag values as data attributes (key with _ → -) */
.kmp-title {} .kmp-title a {}          /* h2 (h3 inside groups); linked when post_url_pattern is set */
.kmp-date {}                           /* <time> */
.kmp-fields {}                         /* the row of field values */
.kmp-field {} .kmp-field-emotion {}    /* one field; also data-field="emotion" */
.kmp-field-name {} .kmp-field-value {} /* its label, and a number/text value */
.kmp-tag {} .kmp-tag[data-value="tender"] {}   /* one tag (values are lowercased, spaces → -) */
.kmp-body {} .kmp-body img {}          /* the post's text */
.kmp-menu {} .kmp-menu-label {} .kmp-menu button[aria-pressed="true"] {}   /* filter row; selected button */
button.kmp-tag {}                      /* a post's tags, when they filter the menu */
.kmp-group {} .kmp-group[data-value="tender"] {} .kmp-group-title {}
.kmp-image {} .kmp-image img {} .kmp-image figcaption {}   /* a photo embed (<figure>) */
.kmp-error {} .kmp-empty {}
```

Write CSS for these classes that copies their current design: fonts, colors, title and date styling, tag pills, spacing. Give it to them along with the script tags. If their site can't run scripts, use the JSON in step 8, or plain `<img src="…">` tags with the CDN URLs.

## 8. Check your work (no key needed)

- `GET /<user>/posts.json?limit=50&filter=emotion:tender&sort=-no` returns `{ user: { name, site, fields: [...] }, posts: [{ slug, title, date, html, url, markdown_url, fields }] }`.
- `GET /<user>/<slug>.json` returns one post.
- `GET /<user>/images/<file name>.json` returns one photo.
- `GET /<user>/feed.xml` (RSS) and `/<user>/feed.json` (JSON Feed) are the feeds. Tags become categories.
- `https://kylemaclachlanphotography.org/?blog=<user>` is their blog on the shared front page.

Only published posts appear in these. Public answers are cached for about a minute, so add any query string (`?v=2`) to see a change immediately.

Errors come back as `{"error": "a sentence you can show the person"}` with a 4xx status.

## A checklist to finish with

- [ ] Every post is imported, with original dates and slugs. Drafts are still drafts.
- [ ] Fields are set up, and every post has its values.
- [ ] Images are uploaded, every image URL is replaced, and alt text is set.
- [ ] Blog name, `site_url` and `post_url_pattern` are set.
- [ ] They have embed code and matching CSS, and know where to paste it.
- [ ] You told them what's published, what's a draft, and what didn't come over, and reminded them they can revoke the key in settings.
