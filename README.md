# blog-cdn

Blog hosting for friends at https://kylemaclachlanphotography.org. Archie makes each friend a username and password. They log in, write posts in markdown and upload photos, then paste a one-line embed into their own site (Squarespace, Neocities, anything). No git involved.

## how it works

One Cloudflare Worker (`blog-cdn`) on the Reaction Future Institute account, plus a D1 database and an R2 bucket.

- **The front page** (`/`, `src/home.js`) is public. No login needed.
  - A left sidebar lists every blog. Each name filters the page to that blog (`/?blog=<user>`), and ↗ goes to the friend's own site.
  - The middle is one feed of every published post from every blog, newest first, 20 per page.
  - Along the bottom is a row of every uploaded photo. It's pinned to the window on desktop and sits at the end of the page on phones. Clicking a photo opens it bigger.
  - It's cached for 60 seconds.

- **Friends** log in at `/login` and use the dashboard at `/dashboard` (`public/app/app.js`):
  - **posts**: a markdown editor with a live preview, and save draft, publish or unpublish. Add photos with the "insert photo" button, by dragging them onto the editor, or by pasting.
  - **embed**: an embed-code builder (`public/app/embedkit.js`).
    - Pick latest posts, one post or one photo, then how many, the order, only one tag, filter buttons, headings per tag, and what to show with it.
    - See it live with their real posts (in their style-tab look, if they made one), then copy the code.
    - The embed buttons on the posts page open it with that post chosen.
  - **style**: a playground for how their posts could look on their own site.
    - Pick a starting look (clean, notebook, newspaper, typewriter, night) or set things one by one: font, sizes, title style, dates, links, tag pills, photo frames, spacing, cards, box colour.
    - It previews their real posts in a sandboxed page with a stand-in for their site's background, then gives CSS to copy (`public/app/stylekit.js`).
    - Only changed settings become CSS, so their site's styles fill in the rest. Nothing is saved on KMP; the browser remembers their choices.
  - **files**: drag-and-drop upload, copy link and delete. Photos also get **describe** (alt text and an optional caption) and **embed code** (a live embed, or a plain `<img>` for sites that block scripts). You can also import a `.md` or `.txt` file as a draft post.
  - **settings**:
    - blog name, site address, and an optional post address pattern (used for feed links);
    - **post fields** and **agent keys** (both below);
    - change password.
- **Post fields** (`src/fields.js`): each blog designs its own, up to 10.
  - Kinds: `tags` (picked from a list, e.g. emotions; or "open", so any tag can be typed while writing), `number` (can count up by itself), and `text` (e.g. where it was written).
  - Values show under each post's title in embeds and on the front page, and tags become RSS categories.
  - Lists can use them: `?filter=<key>:<value>` and `?sort=<key>` in the JSON API, and `data-filter`, `data-sort`, `data-group` and `data-menu` in embeds.
- **Costs** (`src/costs.js`): settings shows each friend what their blog costs, month by month and all time. Archie sees an all-time column at `/admin`.
  - Storage is billed like R2: the average GB stored over the month, at `$0.015` per GB-month, plus `$4.50` per million uploads. The rates are in `RATES`, checked 2026-11-22.
  - Cloudflare's free 10 GB-months and 1M uploads each month are shared across the whole account. A blog only pays its share of anything over that.
  - **Cloudflare's own numbers** (`src/r2usage.js`): once a day (cron in `wrangler.jsonc`) the Worker copies R2's measured storage and request counts for every bucket on the account into D1 (`r2_usage_daily`). Cloudflare's analytics only keep about 13 weeks, so this copy is the history.
    - Each month's free allowance and charge come from the account's real totals. The blog bucket's real total is split between friends by the file sizes recorded here, because Cloudflare measures buckets, not people.
    - `/admin` shows the whole account's R2 by month, the sync status, and a **sync from cloudflare now** button. "charged" there should match the R2 lines on the bill.
    - Needs the secret `CF_ANALYTICS_TOKEN` (an API token with only **Account Analytics: Read**), plus the `CF_ACCOUNT_ID` and `BLOG_BUCKET` vars.
    - Months with no measurements (before the first sync, or locally) fall back to estimates. They're marked "est." for friends and "estimated" on `/admin`.
    - Locally: `CF_ANALYTICS_TOKEN=$(npx wrangler auth token) node scripts/sync-usage-local.mjs` loads the real numbers into the dev database.
  - **`OTHER_STORAGE_GB`** in `wrangler.jsonc` is only used for estimated months: roughly what the account's *other* buckets hold.
  - Deleted files keep their row (`deleted_at`), so past months stay right.
  - **Domains**: at `/admin`, Archie can record a friend's domain paid for through Reaction Future Institute (`HOST_NAME`), with its yearly price and the date it was first paid for. It's charged in that month and every anniversary, and the friend sees it with its next renewal date.
- **Agent keys**: a friend can make a revocable key (settings → "let an AI agent set up your blog").
  - An AI agent uses it as `Authorization: Bearer kmp_…` on `/api/*`, without the friend's password.
  - Keys can't change the password or manage keys.
  - An admin password reset revokes them.
  - The guide agents follow is `public/agents.md` (served at `/agents.md`, with `/llms.txt` pointing to it, and linked from the front page). **Update it whenever the API or embed options change.**
- **Archie's dashboard** is at `/admin`, using the `ADMIN_PASSWORD` Worker secret.
  - **Totals at the top**: blogs, the whole app's cost all time and this month, and locked accounts.
  - **Billing, whole app**: every blog's R2 share and domains added together by month, with a running total.
  - **Accounts**: set any password in one step (leave it blank and one is made and shown once), add domains, or switch an account off.
  - **Lockout**: **three wrong passwords in a row lock an account**, even against the right password. The login page warns how many tries are left, then says "text archie to reset your password". A "locked out" box at the top of `/admin` sets a new password, which unlocks it. A separate limit locks out an IP for 15 minutes after ten wrong passwords on any accounts.
- **Posts** are stored in D1 (`migrations/`). The markdown is rendered to HTML when saved (`src/markdown.js`, markdown-it with HTML turned off, so anything typed as HTML shows as text).
  - A single Enter is a line break.
  - There are no smart quotes or dashes.
  - It adds `++underline++` and `[[box]]`, both from archizzl.com's format. Each published post is also copied to R2 as `<user>/posts/<slug>.md`.
- **Files** go to the R2 bucket `blog-cdn-files` as `<user>/<name>`. They're served straight from the bucket's own domain, **`cdn.kylemaclachlanphotography.org`**, and never pass through the Worker.
  - Files are never overwritten. Uploading the same name again gets a new name, so images can be cached forever.
  - Accepted: JPEG, PNG, WebP, GIF, AVIF, PDF, `.md` and `.txt`, up to 25 MB. SVG and HTML are refused, and contents must match the extension (`src/rules.js`).
  - Photos are shrunk in the browser to 2400px on the long edge. JPEGs are always redrawn, which strips EXIF data, including GPS location.
- **Embedding** (`public/embed.js`):
  ```html
  <script src="https://kylemaclachlanphotography.org/embed.js" data-user="maya" data-post="my-post" async></script>
  <script src="https://kylemaclachlanphotography.org/embed.js" data-user="maya" data-list="10" async></script>
  <script src="https://kylemaclachlanphotography.org/embed.js" data-user="maya" data-image="beach.jpg" async></script>
  ```
  Options: `data-style="none"`, `data-title="no"` and `data-caption="no"`. The script reads `/<user>/<slug>.json`, `/<user>/posts.json` or `/<user>/images/<file>.json`. These are public, open to any site (CORS `*`) and cached for 60 seconds, so edits show up within a minute.
- **Styling** is done on the friend's site, not here.
  - Embeds are plain HTML inserted into their page (no iframe), so the page's own fonts and colors apply.
  - Friends can style these classes: `.kmp-post`, `.kmp-title`, `.kmp-date`, `.kmp-body`, `.kmp-image`, `.kmp-image img` and `.kmp-image figcaption`.
  - embed.js adds a few defaults. They use `:where()`, so they have no specificity, and they go first in `<head>`, so any rule the page writes wins.
  - The settings page lists the classes for friends.
- **Feeds**: `/<user>/feed.xml` (RSS) and `/<user>/feed.json` (JSON Feed).
- **Logins**:
  - Friends' passwords are stored as PBKDF2 hashes. Sessions last 30 days and are stored in D1.
  - Ten wrong passwords from one IP lock that IP out for 15 minutes.
  - Dashboard API calls need an `x-kmp: 1` header, which blocks forged cross-site requests.

## run locally

Wrangler needs Node 22 (`nvm use 22`).

```bash
npm install
npm run dev      # http://localhost:8127; local database and bucket; files served at /_cdn/
npm test         # unit tests + the real Worker against a throwaway local D1/R2
```

- `.dev.vars` (git-ignored) holds the local `ADMIN_PASSWORD`, and sets `SITE_ORIGIN` and `CDN_BASE` to localhost.
- Local data lives in `.wrangler/state`. Delete that folder to start fresh.
- **Sample blogs**: with the dev server running, `node scripts/seed-demo.mjs` creates two local friends with posts and computer-drawn photos:
  - `smallhours`: "small hours", a poetry blog.
  - `xenolab`: "synthetic tenderness", xenofeminist photo and writing.

  Their local passwords are in the script. Then start the `blog-cdn-demo` launch config (port 8128) and open:
  - http://localhost:8128/poetry/: Comic Sans notebook paper. It shows post fields: poems newest first, with one labelled "filter by feeling" row (clicking a tag on a poem filters too), emotion colors, numbered poems, and where each was written.
  - http://localhost:8128/xeno/: dark acid-and-violet grid. Uses `data-style="none"` and styles everything itself.

  Both are plain HTML files in `demo/` that use the same embed codes a friend would paste.
- `demo/index.html` is a bare stand-in for a friend's site. Serve it on another port (launch config `blog-cdn-demo`, port 8128) and open `http://localhost:8128/?user=<name>&post=<slug>`, or `?user=<name>&list=5`.

## archizzl.com

archie's own blog moved here on 2026-11-22, as user `archie`, using `scripts/import-archizzl.mjs`. The script converts the old text-file format and keeps slugs and dates; running it again updates posts instead of duplicating them. archizzl.com keeps its own design: its homepage list and `/blog/post/?p=<slug>` pages read `/archie/posts.json?brief=1` and `/archie/<slug>.json` from here.

## live

**Deployed 2026-11-22**: https://kylemaclachlanphotography.org (`www` redirects), with files at https://cdn.kylemaclachlanphotography.org.
- D1 `blog-cdn` (`e4bb3d02-…`), R2 `blog-cdn-files` with `r2-cors.json` applied, a daily usage-sync cron at 06:20 UTC.
- The old GitHub Pages DNS records are in `DNS-BEFORE-CUTOVER.md`.
- Still to do by hand: a Response Header Transform Rule adding `X-Content-Type-Options: nosniff` on `cdn.` (wrangler's login can't edit zone rules), and removing the custom domain from the `reactionfutureinstitute.github.io` repo's Pages settings.

Later deploys: `npm run deploy`.

## going live (first time, for reference)

```bash
npx wrangler d1 create blog-cdn                 # put the database_id it prints into wrangler.jsonc
npx wrangler r2 bucket create blog-cdn-files
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put CF_ANALYTICS_TOKEN     # API token with only "Account Analytics: Read" (for real R2 costs)
```

Then in the Cloudflare dashboard:

1. **R2 → blog-cdn-files → Settings → Custom Domains**: connect `cdn.kylemaclachlanphotography.org`.
2. **CORS**: `npx wrangler r2 bucket cors set blog-cdn-files --file r2-cors.json` (allows `GET` and `HEAD` from anywhere).
3. **kylemaclachlanphotography.org → Rules → Transform Rules → Response Header**: for hostname `cdn.kylemaclachlanphotography.org`, set `X-Content-Type-Options: nosniff`.
4. **kylemaclachlanphotography.org → DNS**: delete the four GitHub Pages `A` records on the apex and the `www` CNAME. This takes the Reaction Future Institute page off this domain. It's still at reactionfutureinstitute.github.io, and you should also remove the custom domain in that repo's Pages settings.

Then:

```bash
npm run deploy   # applies migrations, deploys, and attaches the apex and www as Worker custom domains
```

Later deploys only need `npm run deploy`. `npm run check` runs the tests plus a build check without deploying.

## backups

```bash
npx wrangler d1 export blog-cdn --remote --output backup.sql
```

R2 files can be copied out with `npx wrangler r2 object get blog-cdn-files/<key>`, or with any S3 tool.
