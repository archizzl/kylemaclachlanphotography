/*
 * kylemaclachlanphotography.org: blog hosting for Archie's friends.
 *
 * Friends log in at /login and write posts and upload files in the dashboard (/dashboard).
 * Archie adds friends and resets passwords at /admin (ADMIN_PASSWORD secret).
 *
 * Posts live in D1. Uploaded files, and a .md copy of each published post, live in the FILES R2
 * bucket, which is served straight from its own domain (CDN_BASE), never through this Worker.
 *
 * Other sites read published posts through:
 *   /embed.js                   (static, in ./public) the one-line embed
 *   /<user>/posts.json          recent posts      /<user>/<slug>.json  one post
 *   /<user>/feed.xml            RSS               /<user>/feed.json    JSON Feed
 *   /<user>/images/<file>.json  one image with its alt text and caption
 */

import {
  adminCookie, checkPassword, clearAdminCookie, clearFails, currentUser, endAllSessions, endSession,
  generatePassword, hashPassword, isAdmin, lockedOut, passwordProblem, recordFail, same, startSession,
} from "./auth.js";
import { renderInline, renderMarkdown } from "./markdown.js";
import { cacheControlFor, checkUpload, cleanFileText, cleanPost, cleanSettings, contentMatches, isImage, usernameProblem } from "./rules.js";
import { jsonFeed, postMarkdownFile, postMdKey, publicImage, publicPost, publicUser, rssFeed } from "./feeds.js";
import { adminLoginPage, adminPage, dashboardPage, loginPage, simplePage } from "./pages.js";
import { html, json, now, readJson, redirect } from "./util.js";

const PUBLIC_CACHE_SECONDS = 60;
const MAX_LIST = 50;

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      console.error(err);
      if (new URL(request.url).pathname.startsWith("/api/")) return json({ error: "Something went wrong on our end. Try again." }, 500);
      return html(simplePage("something went wrong", "the site hit an error. try again in a minute."), 500);
    }
  },
};

const cdnBase = env => String(env.CDN_BASE || "").replace(/\/+$/, "");
// The public address of this site. Set explicitly because wrangler dev rewrites the request's host.
const siteOrigin = (env, url) => String(env.SITE_ORIGIN || url.origin).replace(/\/+$/, "");

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;

  // Send www to the bare domain.
  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
    return Response.redirect(url.toString(), 301);
  }

  // Locally there's no R2 custom domain, so the Worker stands in for it.
  if (path.startsWith("/_cdn/") && cdnBase(env).endsWith("/_cdn")) return localCdn(path.slice(6), env);

  // ---- friends signing in ----
  if (path === "/login" && method === "GET") {
    if (await currentUser(env, request)) return redirect("/dashboard");
    return html(loginPage());
  }
  if (path === "/login" && method === "POST") return login(request, env);
  if (path === "/logout") return redirect("/login", await endSession(env, request));
  if (path === "/dashboard" && method === "GET") {
    const user = await currentUser(env, request);
    if (!user) return redirect("/login");
    return html(dashboardPage(user, { cdnBase: cdnBase(env), origin: siteOrigin(env, url) }));
  }

  // ---- Archie ----
  if (path === "/admin" || path.startsWith("/admin/")) return admin(path, method, request, env);

  // ---- the dashboard's API ----
  if (path.startsWith("/api/")) {
    const user = await currentUser(env, request);
    if (!user) return json({ error: "You've been logged out. Reload the page and log in again." }, 401);
    // Cross-site pages can't send this header without a preflight we never allow, so it blocks forged requests.
    if (method !== "GET" && request.headers.get("x-kmp") !== "1") return json({ error: "Bad request." }, 400);
    return api(path, method, request, env, user, url);
  }

  // ---- what other sites read ----
  const pub = path.match(/^\/([a-z0-9-]{2,30})\/([a-z0-9-]{1,80})\.(json|xml)$/);
  if (pub && (method === "GET" || method === "HEAD")) return cachedPublic(request, ctx, () => publicRoute(pub[1], pub[2], pub[3], env, url));
  const img = path.match(/^\/([a-z0-9-]{2,30})\/images\/([a-z0-9._-]{1,100})\.json$/);
  if (img && (method === "GET" || method === "HEAD")) return cachedPublic(request, ctx, () => publicImageRoute(img[1], img[2], env));
  if (method === "OPTIONS" && (pub || img)) return new Response(null, { status: 204, headers: CORS });

  return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
}

// ---- friend login ----

async function login(request, env) {
  if (await lockedOut(env, request)) return html(loginPage({ message: "Too many wrong passwords. Wait 15 minutes and try again." }), 429);
  const form = await request.formData();
  const username = String(form.get("username") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");
  const user = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  const ok = await checkPassword(password, user?.password_hash);
  if (!user || !ok) {
    await recordFail(env, request);
    return html(loginPage({ message: "That username and password didn't match.", username }), 401);
  }
  if (user.disabled) return html(loginPage({ message: "This account is switched off. Ask Archie.", username }), 403);
  await clearFails(env, request);
  return redirect("/dashboard", await startSession(env, request, user.id));
}

// ---- admin ----

async function admin(path, method, request, env) {
  if (!env.ADMIN_PASSWORD) {
    return html(simplePage("not set up yet", "the admin password hasn't been set. run <code>npx wrangler secret put ADMIN_PASSWORD</code>."), 503);
  }
  if (path === "/admin/login" && method === "POST") {
    if (await lockedOut(env, request)) return html(adminLoginPage("Too many wrong passwords. Wait 15 minutes and try again."), 429);
    const given = String((await request.formData()).get("password") || "");
    if (!(await same(given, env.ADMIN_PASSWORD))) {
      await recordFail(env, request);
      return html(adminLoginPage("That password didn't work."), 401);
    }
    await clearFails(env, request);
    return redirect("/admin", await adminCookie(env, request));
  }
  if (path === "/admin/logout") return redirect("/admin", clearAdminCookie());
  if (!(await isAdmin(env, request))) {
    if (method === "GET" && path === "/admin") return html(adminLoginPage());
    return redirect("/admin");
  }

  if (path === "/admin" && method === "GET") return html(adminPage(await listUsers(env)));

  if (path === "/admin/users" && method === "POST") {
    const form = await request.formData();
    const username = String(form.get("username") || "").trim().toLowerCase();
    const displayName = String(form.get("display_name") || "").trim().slice(0, 100);
    const typed = String(form.get("password") || "").trim();
    const password = typed || generatePassword();
    const problem =
      usernameProblem(username) ||
      passwordProblem(password) ||
      ((await env.DB.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first()) ? `There's already a friend called ${username}.` : null);
    if (problem) return html(adminPage(await listUsers(env), { text: problem, problem: true }), 400);
    await env.DB.prepare("INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .bind(username, displayName, await hashPassword(password), now())
      .run();
    return html(adminPage(await listUsers(env), { text: `added ${username}.`, password }));
  }

  const m = path.match(/^\/admin\/users\/(\d+)\/(password|disabled)$/);
  if (m && method === "POST") {
    const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(Number(m[1])).first();
    if (!user) return redirect("/admin");
    const form = await request.formData();
    if (m[2] === "password") {
      const typed = String(form.get("password") || "").trim();
      const password = typed || generatePassword();
      const problem = passwordProblem(password);
      if (problem) return html(adminPage(await listUsers(env), { text: problem, problem: true }), 400);
      await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(password), user.id).run();
      await endAllSessions(env, user.id);
      return html(adminPage(await listUsers(env), { text: `new password for ${user.username}. they've been logged out everywhere.`, password }));
    }
    const disabled = form.get("disabled") === "1" ? 1 : 0;
    await env.DB.prepare("UPDATE users SET disabled = ? WHERE id = ?").bind(disabled, user.id).run();
    if (disabled) await endAllSessions(env, user.id);
    return html(
      adminPage(await listUsers(env), {
        text: disabled
          ? `${user.username} is switched off. they can't log in, and their posts and feeds are hidden. their files stay on the CDN.`
          : `${user.username} is back on.`,
      })
    );
  }
  return redirect("/admin");
}

async function listUsers(env) {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.disabled,
       (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.published = 1) AS published,
       (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.published = 0) AS drafts,
       (SELECT COUNT(*) FROM files f WHERE f.user_id = u.id) AS files,
       (SELECT COALESCE(SUM(size), 0) FROM files f WHERE f.user_id = u.id) AS bytes
     FROM users u ORDER BY u.username`
  ).all();
  return results;
}

// ---- dashboard API ----

async function api(path, method, request, env, user, url) {
  const base = cdnBase(env);

  if (path === "/api/me" && method === "GET") {
    return json({
      username: user.username,
      display_name: user.display_name,
      site_url: user.site_url,
      post_url_pattern: user.post_url_pattern,
      cdn: `${base}/${user.username}/`,
      feeds: { rss: `${siteOrigin(env, url)}/${user.username}/feed.xml`, json: `${siteOrigin(env, url)}/${user.username}/feed.json` },
    });
  }
  if (path === "/api/me" && method === "PUT") {
    const [s, problem] = cleanSettings(await readJson(request));
    if (problem) return json({ error: problem }, 400);
    await env.DB.prepare("UPDATE users SET display_name = ?, site_url = ?, post_url_pattern = ? WHERE id = ?")
      .bind(s.display_name, s.site_url, s.post_url_pattern, user.id)
      .run();
    return json({ ok: true, ...s });
  }
  if (path === "/api/password" && method === "POST") {
    const body = (await readJson(request)) || {};
    if (!(await checkPassword(String(body.current || ""), user.password_hash))) return json({ error: "Your current password isn't right." }, 400);
    const problem = passwordProblem(body.next);
    if (problem) return json({ error: problem }, 400);
    await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(String(body.next)), user.id).run();
    // Sign out every other device; keep this one.
    await endAllSessions(env, user.id);
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", await startSession(env, request, user.id));
    return new Response(JSON.stringify({ ok: true }), { headers });
  }

  if (path === "/api/preview" && method === "POST") {
    const body = (await readJson(request)) || {};
    return json({ html: renderMarkdown(String(body.body || "").slice(0, 200000)) });
  }

  // posts
  if (path === "/api/posts" && method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id, slug, title, date, published, updated_at FROM posts WHERE user_id = ? ORDER BY date DESC, id DESC"
    )
      .bind(user.id)
      .all();
    return json({ posts: results });
  }
  if (path === "/api/posts" && method === "POST") return savePost(env, user, null, await readJson(request));
  const pm = path.match(/^\/api\/posts\/(\d+)$/);
  if (pm) {
    const post = await env.DB.prepare("SELECT * FROM posts WHERE id = ? AND user_id = ?").bind(Number(pm[1]), user.id).first();
    if (!post) return json({ error: "That post isn't there any more." }, 404);
    if (method === "GET") return json({ post });
    if (method === "PUT") return savePost(env, user, post, await readJson(request));
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(post.id).run();
      await env.FILES.delete(postMdKey(user.username, post.slug));
      return json({ ok: true });
    }
  }

  // files
  if (path === "/api/files" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC, id DESC").bind(user.id).all();
    return json({ files: results.map(f => ({ ...f, url: `${base}/${f.key}` })) });
  }
  if (path === "/api/files" && method === "PUT") return upload(request, env, user, url);
  const fm = path.match(/^\/api\/files\/(\d+)$/);
  if (fm && (method === "DELETE" || method === "PUT")) {
    const file = await env.DB.prepare("SELECT * FROM files WHERE id = ? AND user_id = ?").bind(Number(fm[1]), user.id).first();
    if (!file) return json({ error: "That file isn't there any more." }, 404);
    if (method === "PUT") {
      const t = cleanFileText(await readJson(request));
      await env.DB.prepare("UPDATE files SET alt = ?, caption = ? WHERE id = ?").bind(t.alt, t.caption, file.id).run();
      return json({ file: { ...file, ...t, url: `${base}/${file.key}` } });
    }
    await env.FILES.delete(file.key);
    await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(file.id).run();
    return json({ ok: true });
  }

  return json({ error: "Not found." }, 404);
}

async function savePost(env, user, existing, input) {
  const [p, problem] = cleanPost(input);
  if (problem) return json({ error: problem }, 400);

  // Find a free address: my-post, my-post-2, ...
  let slug = p.slug;
  for (let n = 2; ; n++) {
    const clash = await env.DB.prepare("SELECT id FROM posts WHERE user_id = ? AND slug = ?").bind(user.id, slug).first();
    if (!clash || (existing && clash.id === existing.id)) break;
    slug = `${p.slug.slice(0, 75)}-${n}`;
  }

  const bodyHtml = renderMarkdown(p.body);
  const t = now();
  let id = existing?.id;
  if (existing) {
    await env.DB.prepare("UPDATE posts SET slug = ?, title = ?, body_md = ?, body_html = ?, date = ?, published = ?, updated_at = ? WHERE id = ?")
      .bind(slug, p.title, p.body, bodyHtml, p.date, p.published, t, id)
      .run();
  } else {
    const r = await env.DB.prepare(
      "INSERT INTO posts (user_id, slug, title, body_md, body_html, date, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(user.id, slug, p.title, p.body, bodyHtml, p.date, p.published, t, t)
      .run();
    id = r.meta.last_row_id;
  }

  // Keep the .md copy on the CDN in step: there when published, gone when not.
  if (existing && (existing.slug !== slug || !p.published)) await env.FILES.delete(postMdKey(user.username, existing.slug));
  if (p.published) {
    await env.FILES.put(postMdKey(user.username, slug), postMarkdownFile({ title: p.title, date: p.date, body_md: p.body }), {
      httpMetadata: { contentType: "text/markdown; charset=utf-8", cacheControl: cacheControlFor("text/markdown") },
    });
  }

  const post = await env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first();
  return json({ post });
}

async function upload(request, env, user, url) {
  const [info, problem] = checkUpload(url.searchParams.get("name"), Number(request.headers.get("content-length") || 0));
  if (problem) return json({ error: problem }, 400);
  const data = await request.arrayBuffer();
  if (data.byteLength > 25 * 1024 * 1024) return json({ error: "That file is too big (25 MB at most)." }, 413);
  if (!data.byteLength) return json({ error: "That file was empty." }, 400);
  if (!contentMatches(info.type, data)) return json({ error: "That file doesn't look like the kind of file its name says it is." }, 400);

  // Never overwrite: a file's URL always means the same file, so the CDN can cache it forever.
  const dot = info.name.lastIndexOf(".");
  let name = info.name;
  while (await env.DB.prepare("SELECT 1 FROM files WHERE key = ?").bind(`${user.username}/${name}`).first()) {
    name = `${info.name.slice(0, dot)}-${crypto.randomUUID().slice(0, 4)}${info.name.slice(dot)}`;
  }
  const key = `${user.username}/${name}`;
  await env.FILES.put(key, data, { httpMetadata: { contentType: info.type, cacheControl: cacheControlFor(info.type) } });

  const dim = h => {
    const n = Number(request.headers.get(h));
    return isImage(info.type) && n > 0 && n < 100000 ? Math.round(n) : null;
  };
  const r = await env.DB.prepare(
    "INSERT INTO files (user_id, key, name, content_type, size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(user.id, key, name, info.type, data.byteLength, dim("x-width"), dim("x-height"), now())
    .run();
  const file = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(r.meta.last_row_id).first();
  return json({ file: { ...file, url: `${cdnBase(env)}/${key}` } });
}

// ---- public JSON and feeds ----

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-max-age": "86400",
};

// Embeds can be loaded on every page view of a friend's site, so answers are cached for a minute.
async function cachedPublic(request, ctx, build) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(new URL(request.url).toString(), { method: "GET" });
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  const res = await build();
  if (cache && res.status === 200) {
    const put = cache.put(key, res.clone());
    ctx?.waitUntil ? ctx.waitUntil(put) : await put;
  }
  return res;
}

async function publicRoute(username, name, ext, env, url) {
  const headers = { ...CORS, "cache-control": `public, max-age=${PUBLIC_CACHE_SECONDS}`, "x-content-type-options": "nosniff" };
  const notFound = () => json({ error: "Not found." }, 404, { ...CORS, "cache-control": "public, max-age=30" });

  const user = await env.DB.prepare("SELECT * FROM users WHERE username = ? AND disabled = 0").bind(username).first();
  if (!user) return notFound();
  const base = cdnBase(env);
  const opts = { origin: siteOrigin(env, url), cdnBase: base };
  const recent = async limit =>
    (
      await env.DB.prepare("SELECT * FROM posts WHERE user_id = ? AND published = 1 ORDER BY date DESC, id DESC LIMIT ?")
        .bind(user.id, limit)
        .all()
    ).results;

  if (name === "feed" && ext === "xml") {
    return new Response(rssFeed(user, await recent(20), opts), { headers: { ...headers, "content-type": "application/rss+xml; charset=utf-8" } });
  }
  if (ext !== "json") return notFound();
  if (name === "feed") {
    return json(jsonFeed(user, await recent(20), opts), 200, { ...headers, "content-type": "application/feed+json; charset=utf-8" });
  }
  if (name === "posts") {
    const limit = Math.min(MAX_LIST, Math.max(1, Number(url.searchParams.get("limit")) || 10));
    return json({ user: publicUser(user), posts: (await recent(limit)).map(p => publicPost(user, p, base)) }, 200, headers);
  }
  const post = await env.DB.prepare("SELECT * FROM posts WHERE user_id = ? AND slug = ? AND published = 1").bind(user.id, name).first();
  if (!post) return notFound();
  return json({ user: publicUser(user), post: publicPost(user, post, base) }, 200, headers);
}

async function publicImageRoute(username, name, env) {
  const headers = { ...CORS, "cache-control": `public, max-age=${PUBLIC_CACHE_SECONDS}`, "x-content-type-options": "nosniff" };
  const file = await env.DB.prepare(
    "SELECT f.* FROM files f JOIN users u ON u.id = f.user_id WHERE u.username = ? AND u.disabled = 0 AND f.key = ?"
  )
    .bind(username, `${username}/${name}`)
    .first();
  if (!file || !isImage(file.content_type)) return json({ error: "Not found." }, 404, { ...CORS, "cache-control": "public, max-age=30" });
  return json({ image: publicImage(file, cdnBase(env), renderInline(file.caption)) }, 200, headers);
}

// ---- local stand-in for the CDN ----

async function localCdn(key, env) {
  const obj = await env.FILES.get(decodeURIComponent(key));
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers({ "access-control-allow-origin": "*", "x-content-type-options": "nosniff" });
  obj.writeHttpMetadata(headers);
  return new Response(obj.body, { headers });
}

