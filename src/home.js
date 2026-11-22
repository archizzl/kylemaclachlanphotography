// The public front page: every blog in a sidebar, every published post in one feed, and a row
// of every photo along the bottom. No login needed.

import { escapeHtml as e } from "./util.js";
import { postLink } from "./feeds.js";
import { excerpt } from "./markdown.js";

export const HOME_PAGE_SIZE = 20;
const PHOTO_LIMIT = 200;

export async function loadHome(env, { blog = "", page = 1 } = {}) {
  const offset = (page - 1) * HOME_PAGE_SIZE;
  const { results: blogs } = await env.DB.prepare(
    `SELECT u.username, u.display_name, u.site_url,
       (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.published = 1) AS posts,
       (SELECT COUNT(*) FROM files f WHERE f.user_id = u.id AND f.content_type LIKE 'image/%') AS photos
     FROM users u WHERE u.disabled = 0
     ORDER BY lower(CASE WHEN u.display_name = '' THEN u.username ELSE u.display_name END)`
  ).all();
  const active = blogs.filter(b => b.posts || b.photos);
  const only = active.some(b => b.username === blog) ? blog : "";

  const { results: posts } = await env.DB.prepare(
    `SELECT p.*, u.username, u.display_name, u.post_url_pattern FROM posts p JOIN users u ON u.id = p.user_id
     WHERE p.published = 1 AND u.disabled = 0 AND (?1 = '' OR u.username = ?1)
     ORDER BY p.date DESC, p.updated_at DESC LIMIT ?2 OFFSET ?3`
  )
    .bind(only, HOME_PAGE_SIZE + 1, offset)
    .all();
  const { results: photos } = await env.DB.prepare(
    `SELECT f.*, u.username, u.display_name FROM files f JOIN users u ON u.id = f.user_id
     WHERE f.content_type LIKE 'image/%' AND u.disabled = 0 AND (?1 = '' OR u.username = ?1)
     ORDER BY f.created_at DESC LIMIT ?2`
  )
    .bind(only, PHOTO_LIMIT)
    .all();

  return { blogs: active, only, page, posts: posts.slice(0, HOME_PAGE_SIZE), more: posts.length > HOME_PAGE_SIZE, photos };
}

const name = u => u.display_name || u.username;

function longDate(d) {
  const t = new Date(`${d}T12:00:00Z`);
  return isNaN(t) ? d : t.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

export function homePage({ blogs, only, page, posts, more, photos }, { cdnBase }) {
  const here = blogs.find(b => b.username === only);
  const q = (blog, p) => {
    const s = new URLSearchParams();
    if (blog) s.set("blog", blog);
    if (p > 1) s.set("page", p);
    return s.toString() ? `/?${s}` : "/";
  };

  const sidebar = `<nav class="blogs" aria-label="blogs">
  <h2>blogs</h2>
  <ul>
    <li><a href="/" class="${only ? "" : "on"}">everything</a></li>
    ${blogs
      .map(
        b => `<li title="${e(name(b))}"><a href="${q(b.username)}" class="${b.username === only ? "on" : ""}">${e(name(b))}</a>${
          b.site_url ? `&nbsp;<a class="site" href="${e(b.site_url)}" rel="noopener" title="${e(name(b))}'s own site">↗</a>` : ""
        }</li>`
      )
      .join("\n    ")}
  </ul>
</nav>`;

  const feed = posts.length
    ? posts
        .map(p => {
          const elsewhere = p.post_url_pattern ? postLink(p, p, cdnBase) : "";
          return `<article class="post">
  <p class="byline">${only ? "" : `<a href="${q(p.username)}">${e(name(p))}</a> · `}<time datetime="${e(p.date)}">${longDate(p.date)}</time></p>
  <h2>${e(p.title)}</h2>
  <div class="body">${p.body_html}</div>
  ${elsewhere ? `<p class="more"><a href="${e(elsewhere)}" rel="noopener">read it on ${e(name(p))}'s site →</a></p>` : ""}
</article>`;
        })
        .join("\n")
    : `<p class="muted">no posts here yet.</p>`;

  const pager =
    page > 1 || more
      ? `<p class="pager">${page > 1 ? `<a href="${q(only, page - 1)}">← newer</a>` : ""} ${more ? `<a href="${q(only, page + 1)}">older →</a>` : ""}</p>`
      : "";

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
<title>${here ? `${e(name(here))} · ` : ""}kyle maclachlan photography</title>
<meta name="description" content="writing and photos from a few friends' blogs, all in one place.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap">
<link rel="stylesheet" href="/app/home.css">
</head>
<body>
<header class="masthead">
  <h1><a href="/">kyle maclachlan photography</a></h1>
  <a class="black_button" href="/login">log in</a>
</header>
<div class="layout">
${sidebar}
<main class="feed">
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
