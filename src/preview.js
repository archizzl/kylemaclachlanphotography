/*
 * Preview sites: a blog can turn on <name>.kylemaclachlanphotography.org, which shows just that
 * blog as its own website (its posts, tags and photos, in the look saved in the style tab), so a
 * friend can try it out before buying a domain. <name> comes from the blog's name and follows it
 * when the blog is renamed.
 *
 * The blog Worker (worker.js) turns previews on and off. A separate Worker, kmp-previews
 * (wrangler.previews.jsonc, `export default` below), serves them from a wildcard route and only
 * reads the database.
 *
 * PREVIEW_BASE says what the addresses look like: "https://{name}.kylemaclachlanphotography.org"
 * live, "http://{name}.localhost:8129" locally (.dev.vars).
 */

import { loadHome, homePage } from "./home.js";
import { escapeHtml as e } from "./util.js";

// Names already used on the domain, or that would look official.
const RESERVED = new Set(
  "www cdn mail email smtp imap pop ftp ns ns1 ns2 admin api app apps static assets dashboard login auth status blog blogs help support kmp".split(" ")
);
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// The subdomain for a blog: its name made address-safe ("BRUTE FORCE" -> "brute-force"), or its
// username if the name has no letters or numbers.
export function previewName(user) {
  const fromName = String(user.display_name || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 63)
    .replace(/-+$/, "");
  return fromName || user.username;
}

export function previewUrl(env, name) {
  return name ? previewBase(env).replace("{name}", name) : null;
}

const previewBase = env => String(env.PREVIEW_BASE || "https://{name}.kylemaclachlanphotography.org");

// Which preview a hostname asks for, or null.
export function nameFromHost(env, hostname) {
  const host = new URL(previewBase(env).replace("{name}", "x")).hostname.slice(2); // "kylemaclachlanphotography.org"
  const h = hostname.toLowerCase();
  if (!h.endsWith(`.${host}`)) return null;
  const name = h.slice(0, -host.length - 1);
  return LABEL.test(name) && !RESERVED.has(name) ? name : null;
}

// Checks a name can be used by this blog. Returns a problem, or "".
export async function previewProblem(env, userId, name) {
  if (!LABEL.test(name) || RESERVED.has(name)) {
    return `${name} can't be a preview address. Try a different blog name.`;
  }
  const taken = await env.DB.prepare("SELECT 1 FROM users WHERE preview_host = ? AND id != ?").bind(name, userId).first();
  return taken ? `Another blog's preview already uses ${previewUrl(env, name).replace(/^https?:\/\//, "")}. Try a different blog name.` : "";
}

// ---- the kmp-previews Worker ----

const SLUG = /^\/([a-z0-9-]{1,80})$/;

export default {
  async fetch(request, env) {
    try {
      return await serve(request, env);
    } catch (err) {
      console.error(err);
      return page("something went wrong", "this preview hit an error. try again in a minute.", 500);
    }
  },
};

async function serve(request, env) {
  const url = new URL(request.url);
  const name = nameFromHost(env, url.hostname);
  if (!name) {
    // Only previews should come through here. If the live wildcard route ever catches another of
    // the domain's hostnames (like cdn.), hand it on untouched: a Worker's request to its own route
    // goes to the origin. (Never locally, where that would loop back here.)
    const live = url.protocol === "https:" && url.hostname.endsWith(".kylemaclachlanphotography.org");
    return live ? fetch(request) : page("not found", "", 404);
  }
  if (request.method !== "GET" && request.method !== "HEAD") return page("not found", "", 405);
  if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain", "x-robots-tag": "noindex" } });

  const user = await env.DB.prepare("SELECT username FROM users WHERE preview_host = ? AND disabled = 0").bind(name).first();
  if (!user) return page("no preview here", `there's no preview site at this address. if you renamed your blog, its preview moved to the new name: see settings in your dashboard.`, 404);

  const path = url.pathname.replace(/\/+$/, "") || "/";
  const slug = path === "/" ? "" : SLUG.exec(path)?.[1];
  if (slug === undefined) return page("not found", `that page isn't here. <a href="/">see the rest of the blog</a>.`, 404);

  const pageNum = Math.max(1, parseInt(url.searchParams.get("page"), 10) || 1);
  const tag = String(url.searchParams.get("tag") || "").trim().slice(0, 100);
  const data = await loadHome(env, { blog: user.username, page: pageNum, tag, slug });
  if (slug && !data.posts.length) return page("not found", `that post isn't here. <a href="/">see the rest of the blog</a>.`, 404);

  const origin = String(env.SITE_ORIGIN || "https://kylemaclachlanphotography.org").replace(/\/+$/, "");
  return new Response(homePage(data, { cdnBase: String(env.CDN_BASE || "").replace(/\/+$/, ""), site: { origin } }), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60",
      "x-robots-tag": "noindex",
      "x-frame-options": "DENY",
    },
  });
}

function page(title, message, status) {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${e(title)}</title>
<style>body{font-family:Georgia,serif;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.5}a{color:inherit}</style></head>
<body><h1>${e(title)}</h1>${message ? `<p>${message}</p>` : ""}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex", "cache-control": "public, max-age=60" } }
  );
}
