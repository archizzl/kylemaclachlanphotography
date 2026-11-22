// Run with `npm test`. Drives the real Worker against a throwaway local D1 database and R2 bucket
// (wrangler's getPlatformProxy), the way a browser and an embedding site would.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import worker from "../src/worker.js";

const ORIGIN = "https://kylemaclachlanphotography.org";
const CDN = "https://cdn.kylemaclachlanphotography.org";
let proxy, env;

before(async () => {
  proxy = await getPlatformProxy({ persist: false, environment: undefined });
  env = { ...proxy.env, ADMIN_PASSWORD: "admin-secret-pw", CDN_BASE: CDN, ASSETS: undefined };
  const sql = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8")
    .replace(/--.*$/gm, "")
    .split(";")
    .map(s => s.trim())
    .filter(Boolean);
  for (const s of sql) await env.DB.prepare(s).run();
});
after(() => proxy?.dispose());

// A tiny browser: keeps cookies per "person".
function browser(ip = "1.1.1.1") {
  const jar = new Map();
  async function go(path, { method = "GET", form, body, headers = {}, raw } = {}) {
    const h = new Headers({ "cf-connecting-ip": ip, ...headers });
    if (jar.size) h.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    let payload;
    if (form) payload = new URLSearchParams(form);
    else if (raw) payload = raw;
    else if (body !== undefined) { payload = JSON.stringify(body); h.set("content-type", "application/json"); }
    if (path.startsWith("/api/") && method !== "GET") h.set("x-kmp", "1");
    const res = await worker.fetch(new Request(ORIGIN + path, { method, headers: h, body: payload, redirect: "manual" }), env, { waitUntil() {} });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const v = pair.slice(i + 1);
      if (/Max-Age=0/.test(c)) jar.delete(pair.slice(0, i));
      else jar.set(pair.slice(0, i), v);
    }
    return res;
  }
  go.cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  return go;
}

const archie = browser("9.9.9.9");
let mayaPassword;

test("www goes to the bare domain", async () => {
  const res = await worker.fetch(new Request("https://www.kylemaclachlanphotography.org/login?x=1"), env, {});
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), `${ORIGIN}/login?x=1`);
});

test("admin needs the admin password", async () => {
  assert.match(await (await archie("/admin")).text(), /admin password/);
  assert.equal((await archie("/admin/users", { method: "POST", form: { username: "x" } })).status, 303);
  assert.equal((await archie("/admin/login", { method: "POST", form: { password: "nope" } })).status, 401);
  assert.equal((await archie("/admin/login", { method: "POST", form: { password: "admin-secret-pw" } })).status, 303);
  assert.match(await (await archie("/admin")).text(), /add a friend/);
});

test("archie adds a friend and gets a starting password", async () => {
  const page = await (await archie("/admin/users", { method: "POST", form: { username: "maya", display_name: "Maya", password: "" } })).text();
  mayaPassword = page.match(/<code class="secret">([^<]+)<\/code>/)[1];
  assert.match(mayaPassword, /^[a-z]+-[a-z]+-\d{4}$/);
  assert.match(await (await archie("/admin/users", { method: "POST", form: { username: "maya" } })).text(), /already a friend called maya/);
  assert.match(await (await archie("/admin/users", { method: "POST", form: { username: "admin" } })).text(), /taken by the site/);
});

test("friends log in; wrong passwords don't", async () => {
  const maya = browser("2.2.2.2");
  assert.equal((await maya("/login", { method: "POST", form: { username: "maya", password: "wrong" } })).status, 401);
  assert.equal((await maya("/login", { method: "POST", form: { username: "nobody", password: "wrong" } })).status, 401);
  assert.equal((await maya("/dashboard")).headers.get("location"), "/login");
  const res = await maya("/login", { method: "POST", form: { username: "MAYA", password: mayaPassword } });
  assert.equal(res.headers.get("location"), "/dashboard");
  assert.match(await (await maya("/dashboard")).text(), /"username":"maya"/);
});

test("ten wrong passwords lock an IP out for a while", async () => {
  const guesser = browser("6.6.6.6");
  for (let i = 0; i < 10; i++) await guesser("/login", { method: "POST", form: { username: "maya", password: "guess" + i } });
  const res = await guesser("/login", { method: "POST", form: { username: "maya", password: mayaPassword } });
  assert.equal(res.status, 429);
});

async function loggedInMaya(ip = "3.3.3.3") {
  const maya = browser(ip);
  await maya("/login", { method: "POST", form: { username: "maya", password: mayaPassword } });
  return maya;
}

test("the API needs a login and the anti-forgery header", async () => {
  const stranger = browser("4.4.4.4");
  assert.equal((await stranger("/api/posts")).status, 401);
  const maya = await loggedInMaya();
  // A cross-site form would carry the cookie but can't add the x-kmp header.
  const forged = await worker.fetch(
    new Request(`${ORIGIN}/api/posts`, { method: "POST", headers: { cookie: maya.cookieHeader(), "content-type": "text/plain" }, body: '{"title":"forged"}' }),
    env,
    {}
  );
  assert.equal(forged.status, 400);
});

test("drafts stay private; published posts show up everywhere", async () => {
  const maya = await loggedInMaya();
  const draft = (await (await maya("/api/posts", { method: "POST", body: { title: "Secret Draft", body: "**shh**", published: 0 } })).json()).post;
  assert.equal(draft.slug, "secret-draft");
  assert.equal(draft.body_html, "<p><strong>shh</strong></p>\n");

  const list = await (await maya("/maya/posts.json")).json();
  assert.equal(list.posts.length, 0);
  assert.equal((await maya("/maya/secret-draft.json")).status, 404);
  assert.ok(!(await (await maya("/maya/feed.xml")).text()).includes("Secret Draft"));
  assert.equal(await env.FILES.get("maya/posts/secret-draft.md"), null);

  // Publish it.
  const pub = (await (await maya(`/api/posts/${draft.id}`, { method: "PUT", body: { title: "Secret Draft", body: "**shh**", published: 1 } })).json()).post;
  assert.equal(pub.published, 1);
  const one = await maya("/maya/secret-draft.json?fresh");
  assert.equal(one.headers.get("access-control-allow-origin"), "*");
  const data = await one.json();
  assert.equal(data.post.title, "Secret Draft");
  assert.equal(data.post.markdown_url, `${CDN}/maya/posts/secret-draft.md`);
  assert.equal(data.user.name, "Maya");
  assert.match(await (await env.FILES.get("maya/posts/secret-draft.md")).text(), /^# Secret Draft/);
  assert.match(await (await maya("/maya/feed.xml?fresh")).text(), /<title>Secret Draft<\/title>/);
  assert.equal((await (await maya("/maya/feed.json?fresh")).json()).items.length, 1);

  // Rename and unpublish: old .md goes away.
  await maya(`/api/posts/${draft.id}`, { method: "PUT", body: { title: "Secret Draft", slug: "renamed", body: "x", published: 0 } });
  assert.equal(await env.FILES.get("maya/posts/secret-draft.md"), null);
  assert.equal(await env.FILES.get("maya/posts/renamed.md"), null);
  assert.equal((await maya("/maya/renamed.json?fresh2")).status, 404);
});

test("two posts with the same title get different addresses", async () => {
  const maya = await loggedInMaya();
  const a = (await (await maya("/api/posts", { method: "POST", body: { title: "Same" } })).json()).post;
  const b = (await (await maya("/api/posts", { method: "POST", body: { title: "Same" } })).json()).post;
  assert.equal(a.slug, "same");
  assert.equal(b.slug, "same-2");
});

test("uploads: photos go to R2 under the friend's name; fakes and SVGs are refused", async () => {
  const maya = await loggedInMaya();
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const up = async (name, bytes, type = "image/jpeg") =>
    maya(`/api/files?name=${encodeURIComponent(name)}`, { method: "PUT", raw: bytes, headers: { "content-type": type, "content-length": String(bytes.byteLength), "x-width": "800", "x-height": "600" } });

  const first = (await (await up("Beach Day.JPG", jpg)).json()).file;
  assert.equal(first.key, "maya/beach-day.jpg");
  assert.equal(first.url, `${CDN}/maya/beach-day.jpg`);
  assert.equal(first.width, 800);
  const obj = await env.FILES.get("maya/beach-day.jpg");
  assert.equal(obj.httpMetadata.contentType, "image/jpeg");
  assert.match(obj.httpMetadata.cacheControl, /immutable/);

  // Same name again: new file, old one untouched.
  const second = (await (await up("beach-day.jpg", jpg)).json()).file;
  assert.notEqual(second.key, first.key);
  assert.match(second.key, /^maya\/beach-day-[0-9a-f]{4}\.jpg$/);

  const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
  assert.equal((await up("evil.jpg", html)).status, 400);
  assert.equal((await up("logo.svg", html, "image/svg+xml")).status, 400);
  assert.equal((await up("page.html", html, "text/html")).status, 400);

  const files = (await (await maya("/api/files")).json()).files;
  assert.equal(files.length, 2);
  assert.equal((await maya(`/api/files/${first.id}`, { method: "DELETE" })).status, 200);
  assert.equal(await env.FILES.get("maya/beach-day.jpg"), null);
});

test("friends can't touch each other's posts or files", async () => {
  await archie("/admin/users", { method: "POST", form: { username: "sam", password: "sam-password-1" } });
  const sam = browser("5.5.5.5");
  await sam("/login", { method: "POST", form: { username: "sam", password: "sam-password-1" } });
  const maya = await loggedInMaya();
  const mine = (await (await maya("/api/posts", { method: "POST", body: { title: "Mine" } })).json()).post;
  assert.equal((await sam(`/api/posts/${mine.id}`)).status, 404);
  assert.equal((await sam(`/api/posts/${mine.id}`, { method: "DELETE" })).status, 404);
  assert.equal((await sam("/api/posts")).status, 200);
  assert.ok(!(await (await sam("/api/posts")).json()).posts.some(p => p.title === "Mine"));
});

test("changing a password logs out other devices; resetting logs out everywhere", async () => {
  const laptop = await loggedInMaya("7.7.7.1");
  const phone = await loggedInMaya("7.7.7.2");
  assert.equal((await laptop("/api/password", { method: "POST", body: { current: "wrong", next: "new-password-1" } })).status, 400);
  assert.equal((await laptop("/api/password", { method: "POST", body: { current: mayaPassword, next: "new-password-1" } })).status, 200);
  mayaPassword = "new-password-1";
  assert.equal((await laptop("/api/me")).status, 200); // this device stays in
  assert.equal((await phone("/api/me")).status, 401); // the other one is out

  const users = await env.DB.prepare("SELECT id FROM users WHERE username = 'maya'").first();
  const page = await (await archie(`/admin/users/${users.id}/password`, { method: "POST", form: { password: "" } })).text();
  mayaPassword = page.match(/<code class="secret">([^<]+)<\/code>/)[1];
  assert.equal((await laptop("/api/me")).status, 401);
});

test("disabled friends can't log in and their feeds disappear", async () => {
  const maya = await loggedInMaya("8.8.8.1");
  await maya("/api/posts", { method: "POST", body: { title: "Visible", published: 1 } });
  assert.equal((await maya("/maya/visible.json?a")).status, 200);
  const { id } = await env.DB.prepare("SELECT id FROM users WHERE username = 'maya'").first();
  await archie(`/admin/users/${id}/disabled`, { method: "POST", form: { disabled: "1" } });
  assert.equal((await maya("/api/me")).status, 401);
  assert.equal((await maya("/maya/visible.json?b")).status, 404);
  assert.equal((await browser("8.8.8.2")("/login", { method: "POST", form: { username: "maya", password: mayaPassword } })).status, 403);
  await archie(`/admin/users/${id}/disabled`, { method: "POST", form: { disabled: "0" } });
  assert.equal((await maya("/maya/visible.json?c")).status, 200);
});
