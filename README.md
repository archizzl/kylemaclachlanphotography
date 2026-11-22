# blog-cdn

Blog hosting for friends at https://kylemaclachlanphotography.org. Archie makes each friend a username and password. They log in, write posts in markdown and upload photos, then paste a one-line embed into their own site (Squarespace, Neocities, anything). No git involved.

## how it works

One Cloudflare Worker (`blog-cdn`) on the Reaction Future Institute account, plus a D1 database and an R2 bucket.

- **Friends** log in at `/login` and use the dashboard at `/dashboard` (`public/app/app.js`):
  - **posts**: a markdown editor with a live preview, an "insert photo" button, and save draft, publish or unpublish.
  - **files**: drag-and-drop upload, copy link and delete. Photos also get **describe** (alt text and an optional caption) and **embed code** (a live embed, or a plain `<img>` for sites that block scripts). You can also import a `.md` or `.txt` file as a draft post.
  - **settings**: name, site address, an optional post address pattern (used for feed links), and change password.
- **Archie** manages friends at `/admin`, using the `ADMIN_PASSWORD` Worker secret. From there he can add a friend (a password is made up if left blank and shown once), reset a password (which logs them out everywhere), and switch an account off or back on.
- **Posts** are stored in D1 (`migrations/`). The markdown is rendered to HTML when saved (`src/markdown.js`, markdown-it with HTML turned off, so anything typed as HTML shows as text). Each published post is also copied to R2 as `<user>/posts/<slug>.md`.
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
- `demo/index.html` is a stand-in for a friend's site. Serve it on another port (launch config `blog-cdn-demo`, port 8128) and open `http://localhost:8128/?user=<name>&post=<slug>`, or `?user=<name>&list=5`.

## going live (first time)

```bash
npx wrangler d1 create blog-cdn                 # put the database_id it prints into wrangler.jsonc
npx wrangler r2 bucket create blog-cdn-files
npx wrangler secret put ADMIN_PASSWORD
```

Then in the Cloudflare dashboard:

1. **R2 → blog-cdn-files → Settings → Custom Domains**: connect `cdn.kylemaclachlanphotography.org`.
2. **R2 → blog-cdn-files → Settings → CORS policy**: allow `GET` and `HEAD` from `*`.
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
