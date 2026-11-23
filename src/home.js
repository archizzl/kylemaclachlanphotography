// The public front page: every blog in a sidebar, every published post in one feed, and a row
// of every photo along the bottom. No login needed.
//   /                       everything
//   /<blog>                 one blog's feed            /<blog>?tag=nyc   only posts tagged #nyc
//   /<blog>/<post>          one post

import { escapeHtml as e } from "./util.js";
import { postLink } from "./feeds.js";
import { excerpt } from "./markdown.js";
import { parseJson, publicFields } from "./fields.js";

export const HOME_PAGE_SIZE = 20;
const PHOTO_LIMIT = 200;

export async function loadHome(env, { blog = "", page = 1, tag = "", slug = "" } = {}) {
  const offset = (page - 1) * HOME_PAGE_SIZE;
  const { results: blogs } = await env.DB.prepare(
    `SELECT u.username, u.display_name, u.site_url,
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
    `SELECT p.*, u.username, u.display_name, u.post_url_pattern, u.fields_json AS user_fields FROM posts p JOIN users u ON u.id = p.user_id
     WHERE p.published = 1 AND u.disabled = 0 AND (?1 = '' OR u.username = ?1) AND (?4 = '' OR p.slug = ?4)
       AND (?5 = '' OR EXISTS (SELECT 1 FROM json_each(p.fields_json) f, json_each(f.value) t
                              WHERE f.type = 'array' AND lower(t.value) = lower(?5)))
     ORDER BY p.date DESC, p.updated_at DESC LIMIT ?2 OFFSET ?3`
  )
    .bind(only, HOME_PAGE_SIZE + 1, offset, slug, tag)
    .all();
  const { results: photos } = await env.DB.prepare(
    `SELECT f.*, u.username, u.display_name FROM files f JOIN users u ON u.id = f.user_id
     WHERE f.content_type LIKE 'image/%' AND f.deleted_at IS NULL AND u.disabled = 0 AND (?1 = '' OR u.username = ?1)
     ORDER BY f.created_at DESC LIMIT ?2`
  )
    .bind(only, PHOTO_LIMIT)
    .all();

  return {
    blogs: active,
    blogExists: Boolean(found),
    only,
    page,
    tag,
    slug,
    posts: posts.slice(0, HOME_PAGE_SIZE),
    more: !slug && posts.length > HOME_PAGE_SIZE,
    photos,
  };
}

const name = u => u.display_name || u.username;

// A post's own fields (emotion, number, location…) as a small line under its title.
function fieldLine(p) {
  const defs = parseJson(p.user_fields, []);
  const values = publicFields(defs, parseJson(p.fields_json, {}));
  const parts = defs
    .filter(d => values[d.key] !== undefined)
    .map(d =>
      d.kind === "tags"
        ? `<span class="field tags">${values[d.key]
            .map(v => `<a class="tag" href="/${e(p.username)}?tag=${encodeURIComponent(v)}" title="${e(name(p))}'s posts tagged #${e(v)}">#${e(v)}</a>`)
            .join(" ")}</span>`
        : `<span class="field"><span class="fname">${e(d.name)}</span> ${e(values[d.key])}</span>`
    );
  return parts.length ? `<p class="fields">${parts.join("")}</p>` : "";
}

function longDate(d) {
  const t = new Date(`${d}T12:00:00Z`);
  return isNaN(t) ? d : t.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

export function homePage({ blogs, only, page, tag, slug, posts, more, photos }, { cdnBase }) {
  const here = blogs.find(b => b.username === only) || (only ? { username: only, display_name: posts[0]?.display_name || "" } : null);
  const q = (blog, p, t) => {
    const s = new URLSearchParams();
    if (t) s.set("tag", t);
    if (p > 1) s.set("page", p);
    const query = s.toString();
    return `/${blog || ""}${query ? `?${query}` : ""}`;
  };
  const single = Boolean(slug && posts[0]);

  const sidebar = `<nav class="blogs" aria-label="blogs">
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
  <p class="agents"><a href="/agents.md">guide for AI agents</a></p>
</nav>`;

  const feed = posts.length
    ? posts
        .map(p => {
          const elsewhere = p.post_url_pattern ? postLink(p, p, cdnBase) : "";
          return `<article class="post">
  <p class="byline">${only ? "" : `<a href="/${e(p.username)}">${e(name(p))}</a> · `}<time datetime="${e(p.date)}">${longDate(p.date)}</time></p>
  <h2>${single ? e(p.title) : `<a href="/${e(p.username)}/${e(p.slug)}">${e(p.title)}</a>`}</h2>
  ${fieldLine(p)}
  <div class="body">${p.body_html}</div>
  ${elsewhere ? `<p class="more"><a href="${e(elsewhere)}" rel="noopener">read it on ${e(name(p))}'s site →</a></p>` : ""}
</article>`;
        })
        .join("\n")
    : `<p class="muted">no posts here yet.</p>`;

  const pager =
    page > 1 || more
      ? `<p class="pager">${page > 1 ? `<a href="${q(only, page - 1, tag)}">← newer</a>` : ""} ${more ? `<a href="${q(only, page + 1, tag)}">older →</a>` : ""}</p>`
      : "";
  // A tag filter says what it's showing and how to clear it, like archizzl.com's list.
  const filter = tag ? `<p class="filter">showing <a class="tag" href="${q(only, 1, tag)}">#${e(tag)}</a> <a class="clear" href="/${e(only)}">(clear)</a></p>` : "";
  const back = single ? `<p class="filter"><a href="/${e(only)}">← all of ${e(name(here))}</a></p>` : "";
  const pageTitle = single ? `${e(posts[0].title)} · ${e(name(here))} · ` : here ? `${tag ? `#${e(tag)} · ` : ""}${e(name(here))} · ` : "";

  const strip = photos.length
    ? `<section class="photos" aria-label="photos">
  <h2>photos${here ? ` from ${e(name(here))}` : ""}</h2>
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
<title>${pageTitle}kyle maclachlan photography</title>
<meta name="description" content="writing and photos from a few friends' blogs, all in one place.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap">
<link rel="stylesheet" href="/app/home.css">
<link rel="alternate" type="text/markdown" title="guide for AI agents setting up a blog here" href="/agents.md">
</head>
<body>
<header class="masthead">
  <h1><a href="/">kyle maclachlan photography</a></h1>
  <a class="black_button" href="/login">log in</a>
</header>
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
<script src="/app/home.js" defer></script>
</body>
</html>`;
}
