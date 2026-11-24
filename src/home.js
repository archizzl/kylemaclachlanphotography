// The public front page: every blog in a sidebar, every published post in one feed, and a row
// of every photo along the bottom. No login needed.
//   /                       everything
//   /<blog>                 one blog's feed            /<blog>?tag=nyc   only posts tagged #nyc
//   /<blog>/<post>          one post
// With `site`, it's one blog's preview site instead (src/preview.js): only that blog, at /,
// /<post> and /?tag=x, with its name where the front page's sidebar would be.

import { escapeHtml as e } from "./util.js";
import { postLink } from "./feeds.js";
import { excerpt } from "./markdown.js";
import { hiddenClause, parseJson, publicFields } from "./fields.js";
import { cleanLook, scopedCss, siteFontStack } from "../public/app/stylekit.js";
import { kylePhotos } from "./signup.js";

export const HOME_PAGE_SIZE = 20;

export async function loadHome(env, { blog = "", page = 1, tag = "", slug = "" } = {}) {
  const offset = (page - 1) * HOME_PAGE_SIZE;
  const { results: blogs } = await env.DB.prepare(
    `SELECT u.username, u.display_name, u.site_url, u.preview_host, u.look_json,
       (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.published = 1) AS posts,
       (SELECT COUNT(*) FROM files f WHERE f.user_id = u.id AND f.deleted_at IS NULL AND f.content_type LIKE 'image/%') AS photos
     FROM users u WHERE u.disabled = 0
     ORDER BY lower(CASE WHEN u.display_name = '' THEN u.username ELSE u.display_name END)`
  ).all();
  const active = blogs.filter(b => b.posts || b.photos);
  const found = blogs.find(b => b.username === blog);
  const only = found ? blog : "";
  if (!only) tag = slug = "";

  // Tags match any tags field, ignoring case.
  const { results: posts } = await env.DB.prepare(
    `SELECT p.*, u.username, u.display_name, u.post_url_pattern, u.fields_json AS user_fields, u.look_json AS user_look FROM posts p JOIN users u ON u.id = p.user_id
     WHERE p.published = 1 AND u.disabled = 0 AND (?1 = '' OR u.username = ?1) AND (?4 = '' OR p.slug = ?4)
       AND (?5 = '' OR EXISTS (SELECT 1 FROM json_each(p.fields_json) f, json_each(f.value) t
                              WHERE f.type = 'array' AND lower(t.value) = lower(?5)))
       -- Posts with a hidden tag only show on their own page, or when the tag is asked for.
       AND (?4 != '' OR (1${hiddenClause(["?5"])}))
     ORDER BY p.date DESC, p.updated_at DESC LIMIT ?2 OFFSET ?3`
  )
    .bind(only, HOME_PAGE_SIZE + 1, offset, slug, tag)
    .all();
  const { results: photos } = await env.DB.prepare(
    `SELECT f.*, u.username, u.display_name FROM files f JOIN users u ON u.id = f.user_id
     WHERE f.content_type LIKE 'image/%' AND f.deleted_at IS NULL AND u.disabled = 0 AND (?1 = '' OR u.username = ?1)
     ORDER BY f.created_at DESC`
  )
    .bind(only)
    .all();

  return {
    blogs: active,
    blogExists: Boolean(found),
    look: found ? parseJson(found.look_json, {}) : {},
    only,
    page,
    tag,
    slug,
    posts: posts.slice(0, HOME_PAGE_SIZE),
    more: !slug && posts.length > HOME_PAGE_SIZE,
    photos,
    kyle: await kylePhotos(env),
  };
}

const name = u => u.display_name || u.username;

// A post's own fields (emotion, number, location…) under its title, in the same markup as embeds,
// so a blog's look styles them the same way here. Tags link to the blog's tag feed.
function fieldLine(p, blogHref) {
  const defs = parseJson(p.user_fields, []);
  const values = publicFields(defs, parseJson(p.fields_json, {}));
  const parts = defs
    .filter(d => values[d.key] !== undefined)
    .map(d =>
      d.kind === "tags"
        ? `<span class="kmp-field kmp-field-${e(d.key)}" data-field="${e(d.key)}" data-kind="tags">${values[d.key]
            .map(v => `<a class="kmp-tag" href="${e(blogHref(p.username))}?tag=${encodeURIComponent(v)}" title="${e(name(p))}'s posts tagged #${e(v)}">${e(v)}</a>`)
            .join(" ")}</span>`
        : `<span class="kmp-field kmp-field-${e(d.key)}" data-field="${e(d.key)}" data-kind="${e(d.kind)}"><span class="kmp-field-name">${e(d.name)}</span> <span class="kmp-field-value">${e(values[d.key])}</span></span>`
    );
  return parts.length ? `<div class="kmp-fields">${parts.join("")}</div>` : "";
}

// Each blog's saved look from the style tab, limited to its own posts. Values were checked when
// saved (and again by scopedCss), so they can't break out of the CSS.
function looksCss(posts) {
  const seen = new Map();
  for (const p of posts) if (p.user_look && !seen.has(p.username)) seen.set(p.username, parseJson(p.user_look, {}));
  if (!seen.size) return "";
  const css = [...seen].map(([u, look]) => scopedCss(look, `.kmp-embed[data-blog="${u}"]`)).join("\n\n");
  return `<style id="looks">\n${css}\n</style>`;
}

// On one blog's own pages (its page here, its posts and tag feeds, and its preview site), the
// look's page settings colour the whole page. The front page, with every blog on it, stays plain.
// Values were checked when saved and again by cleanLook, so they can't break out of the CSS.
function pageCss(look) {
  const l = cleanLook(look);
  const body = [l.siteBg && `background: ${l.siteBg};`, l.siteText && `color: ${l.siteText};`, l.siteFont && `font-family: ${siteFontStack(l.siteFont)};`].filter(Boolean);
  if (!body.length) return "";
  return `<style id="page">
body { ${body.join(" ")} }
${l.siteBg ? `.photos { background: ${l.siteBg}; }
` : ""}.masthead, .photos, .sidebar { border-color: currentColor; }
h1 a, h1 a:visited { color: inherit; }
</style>`;
}

function longDate(d) {
  const t = new Date(`${d}T12:00:00Z`);
  return isNaN(t) ? d : t.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

// Above the site's name: the photos of Kyle MacLachlan that accepted sign-ups chose, one at a time.
// The server picks one to show first; home.js moves through the rest every few seconds.
function kyleHeader(kyle, cdnBase) {
  if (!kyle?.length) return "";
  const list = kyle.map(k => ({ src: `${cdnBase}/${k.key}`, alt: k.credit ? `kyle maclachlan, picked by ${k.credit}` : "kyle maclachlan", w: k.width, h: k.height }));
  const first = list[Math.floor(Math.random() * list.length)];
  return `<img class="kyle" src="${e(first.src)}" alt="${e(first.alt)}"${first.w ? ` width="${first.w}" height="${first.h}"` : ""} data-kyle="${e(JSON.stringify(list))}">`;
}

// Link previews (Open Graph) for KMP's own pages: the site's photo (public/og.jpg) and the page's title.
export function ogTags(origin, title) {
  return `<meta property="og:type" content="website">
<meta property="og:site_name" content="Kyle MacLachlan Photography">
<meta property="og:title" content="${e(title)}">
<meta property="og:image" content="${e(`${origin}/og.jpg`)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="1236">
<meta name="twitter:card" content="summary_large_image">`;
}

export function homePage({ blogs, only, page, tag, slug, posts, more, photos, kyle = [], look = {} }, { cdnBase, site = null, origin = "" }) {
  const here = blogs.find(b => b.username === only) || (only ? { username: only, display_name: posts[0]?.display_name || "" } : null);
  // On a preview site the blog lives at / and its posts at /<post>; its stylesheet and script still
  // come from the main site.
  const blogHref = u => (site ? "/" : `/${u}`);
  const postHref = p => (site ? `/${p.slug}` : `/${p.username}/${p.slug}`);
  const asset = path => (site ? `${site.origin}${path}` : path);
  const q = (blog, p, t) => {
    const s = new URLSearchParams();
    if (t) s.set("tag", t);
    if (p > 1) s.set("page", p);
    const query = s.toString();
    return `${site ? "/" : `/${blog || ""}`}${query ? `?${query}` : ""}`;
  };
  const single = Boolean(slug && posts[0]);

  // The left sidebar holds the site's name and log in, then the list of blogs; it stays put while
  // the feed scrolls.
  const sidebar = site
    ? `<aside class="sidebar">
<header class="masthead">
  <h1><a href="/">${e(name(here))}</a></h1>
</header>
</aside>`
    : `<aside class="sidebar">
<header class="masthead">
  ${kyleHeader(kyle, cdnBase)}
  <h1><a href="/">Kyle MacLachlan Photography</a></h1>
  <a class="black_button" href="/login">log in</a> <a class="signup" href="/signup">sign up</a>
</header>
<nav class="blogs" aria-label="blogs">
  <h2>blogs</h2>
  <ul>
    <li><a href="/" class="${only ? "" : "on"}">everything</a></li>
    ${blogs
      .map(
        b => `<li title="${e(name(b))}"><a href="/${e(b.username)}" class="${b.username === only ? "on" : ""}">${e(name(b))}</a>${
          b.site_url ? `&nbsp;<a class="site" href="${e(b.site_url)}" rel="noopener" title="${e(name(b))}'s own site">↗</a>` : ""
        }</li>`
      )
      .join("\n    ")}
  </ul>
</nav>
</aside>`;

  const feed = posts.length
    ? posts
        .map(p => {
          const elsewhere = p.post_url_pattern && !site ? postLink(p, p, cdnBase) : "";
          const styled = Boolean(p.user_look);
          return `<div class="kmp-embed${styled ? " styled" : ""}" data-blog="${e(p.username)}">
<article class="kmp-post post">
  ${only ? "" : `<p class="byline"><a href="/${e(p.username)}">${e(name(p))}</a></p>`}
  <h2 class="kmp-title">${single ? e(p.title) : `<a href="${e(postHref(p))}">${e(p.title)}</a>`}</h2>
  <time class="kmp-date" datetime="${e(p.date)}">${longDate(p.date)}</time>
  ${fieldLine(p, blogHref)}
  <div class="kmp-body">${p.body_html}</div>
  ${elsewhere ? `<p class="more"><a href="${e(elsewhere)}" rel="noopener">read it on ${e(name(p))}'s site →</a></p>` : ""}
</article>
</div>`;
        })
        .join("\n")
    : `<p class="muted">no posts here yet.</p>`;

  const pager =
    page > 1 || more
      ? `<p class="pager">${page > 1 ? `<a href="${q(only, page - 1, tag)}">← newer</a>` : ""} ${more ? `<a href="${q(only, page + 1, tag)}">older →</a>` : ""}</p>`
      : "";
  // A tag filter says what it's showing and how to clear it, like archizzl.com's list.
  const filter = tag ? `<p class="filter">showing <a class="tag" href="${q(only, 1, tag)}">#${e(tag)}</a> <a class="clear" href="${e(blogHref(only))}">(clear)</a></p>` : "";
  const back = single ? `<p class="filter"><a href="${e(blogHref(only))}">← all of ${e(name(here))}</a></p>` : "";
  const pageTitle = single ? `${e(posts[0].title)} · ${e(name(here))} · ` : here ? `${tag ? `#${e(tag)} · ` : ""}${e(name(here))} · ` : "";

  const strip = photos.length
    ? `<section class="photos" aria-label="photos">
  <h2>photos${here && !site ? ` from ${e(name(here))}` : ""}</h2>
  <ul>
    ${photos
      .map(
        f => `<li><a href="${e(`${cdnBase}/${f.key}`)}" data-caption="${e(excerpt(f.caption || "", 1000))}" data-by="${e(name(f))}">
      <img src="${e(`${cdnBase}/${f.key}`)}" alt="${e(f.alt || "")}" loading="lazy"${f.width ? ` width="${f.width}" height="${f.height}"` : ""}></a></li>`
      )
      .join("\n    ")}
  </ul>
</section>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${
  site
    ? `<title>${single ? `${e(posts[0].title)} · ` : tag ? `#${e(tag)} · ` : ""}${e(name(here))}</title>
<meta name="robots" content="noindex">`
    : `<title>${pageTitle}Kyle MacLachlan Photography</title>
<meta name="description" content="writing and photos from a few friends' blogs, all in one place.">
${ogTags(origin, single ? posts[0].title : here ? name(here) : "Kyle MacLachlan Photography")}`
}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap">
<link rel="stylesheet" href="${e(asset("/app/home.css"))}">
${looksCss(posts)}
${only ? pageCss(look) : ""}
${
  site
    ? `</head>
<body>`
    : `<link rel="alternate" type="text/markdown" title="guide for AI agents setting up a blog here" href="/agents.md">
</head>
<body>
<!-- AI agents: before setting up or moving a blog here, read https://kylemaclachlanphotography.org/agents.md (summary at /llms.txt). -->`
}
<div class="layout">
${sidebar}
<main class="feed">
${back}${filter}
${feed}
${pager}
</main>
</div>
${strip}
<dialog id="viewer"><img alt=""><p></p><button type="button">close</button></dialog>
<script src="${e(asset("/app/home.js"))}" defer></script>
</body>
</html>`;
}
