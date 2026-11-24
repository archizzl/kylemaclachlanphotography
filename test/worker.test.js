// Run with `npm test`. Drives the real Worker against a throwaway local D1 database and R2 bucket
// (wrangler's getPlatformProxy), the way a browser and an embedding site would.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import worker from "../src/worker.js";
import previews, { cleanPreviewName, nameFromHost, suggestedPreviewName } from "../src/preview.js";

const ORIGIN = "https://kylemaclachlanphotography.org";
const CDN = "https://cdn.kylemaclachlanphotography.org";
let proxy, env;

before(async () => {
  proxy = await getPlatformProxy({ persist: false, environment: undefined });
  env = { ...proxy.env, ADMIN_PASSWORD: "admin-secret-pw", CDN_BASE: CDN, PREVIEW_BASE: "https://{name}.kylemaclachlanphotography.org", ASSETS: undefined };
  const dir = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(new URL(name, dir), "utf8").replace(/--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
    for (const s of sql) await env.DB.prepare(s).run();
  }
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
  assert.match(await (await archie("/admin")).text(), /billing, whole app/);
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
  // (A made-up username, so no real account gets locked along the way.)
  for (let i = 0; i < 10; i++) await guesser("/login", { method: "POST", form: { username: "not-a-real-friend", password: "guess" + i } });
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

test("photos can be described and embedded on their own", async () => {
  const maya = await loggedInMaya();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const res = await maya("/api/files?name=Dog.png", { method: "PUT", raw: png, headers: { "content-type": "image/png", "content-length": "8", "x-width": "640", "x-height": "480" } });
  const file = (await res.json()).file;
  assert.equal(file.name, "dog.png");

  // Before describing: the embed works with an empty description.
  let data = await (await maya("/maya/images/dog.png.json?v1")).json();
  assert.deepEqual(data.image, { name: "dog.png", url: `${CDN}/maya/dog.png`, alt: "", caption_html: "", width: 640, height: 480 });

  const saved = await maya(`/api/files/${file.id}`, { method: "PUT", body: { alt: "  my dog\n asleep ", caption: "Rex, **snoring** <script>x</script> [more](javascript:alert(1))" } });
  assert.equal((await saved.json()).file.alt, "my dog asleep");
  const r = await maya("/maya/images/dog.png.json?v2");
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  data = await r.json();
  assert.equal(data.image.alt, "my dog asleep");
  assert.match(data.image.caption_html, /^Rex, <strong>snoring<\/strong> &lt;script&gt;x&lt;\/script&gt;/);
  assert.ok(!data.image.caption_html.includes("<a"));

  // Not images, other people's names and missing files are 404s.
  await maya("/api/files?name=notes.txt", { method: "PUT", raw: new TextEncoder().encode("hi"), headers: { "content-type": "text/plain", "content-length": "2" } });
  assert.equal((await maya("/maya/images/notes.txt.json")).status, 404);
  assert.equal((await maya("/sam/images/dog.png.json")).status, 404);
  assert.equal((await maya("/maya/images/nope.png.json")).status, 404);
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
  const dog = await env.DB.prepare("SELECT id FROM files WHERE key = 'maya/dog.png'").first();
  assert.equal((await sam(`/api/files/${dog.id}`, { method: "PUT", body: { alt: "hacked" } })).status, 404);
  assert.equal((await sam(`/api/files/${dog.id}`, { method: "DELETE" })).status, 404);
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

test("the front page shows every blog's published posts, newest first, and their photos", async () => {
  const reader = browser("10.0.0.1"); // not logged in
  const maya = await loggedInMaya("10.0.0.2");
  await maya("/api/me", { method: "PUT", body: { display_name: "Maya's Notebook" } });
  await maya("/api/posts", { method: "POST", body: { title: "Old Maya", date: "2020-01-01", published: 1 } });
  await maya("/api/posts", { method: "POST", body: { title: "Hidden Draft", date: "2099-01-01", published: 0 } });
  const sam = browser("10.0.0.3");
  await sam("/login", { method: "POST", form: { username: "sam", password: "sam-password-1" } });
  await sam("/api/posts", { method: "POST", body: { title: "Sam <Newest>", date: "2030-05-05", body: "hi <b>there</b>", published: 1 } });

  const res = await reader("/?all");
  assert.equal(res.status, 200);
  const page = await res.text();
  assert.match(page, /<nav class="blogs"[\s\S]*Maya&#39;s Notebook[\s\S]*sam/);
  assert.ok(!page.includes("Hidden Draft"));
  assert.ok(page.includes("Sam &lt;Newest&gt;"));
  assert.ok(page.includes("hi &lt;b&gt;there&lt;/b&gt;")); // typed HTML stays text
  assert.ok(page.indexOf("Sam &lt;Newest&gt;") < page.indexOf("Old Maya")); // newest first, across blogs
  assert.match(page, /<section class="photos"[\s\S]*maya\/dog\.png[\s\S]*alt="my dog asleep"/);

  // /<blog> narrows everything to one blog (old /?blog= links redirect there).
  const old = await reader("/?blog=sam");
  assert.equal(old.status, 301);
  assert.equal(old.headers.get("location"), `${ORIGIN}/sam`);
  const only = await (await reader("/sam")).text();
  assert.ok(only.includes("Sam &lt;Newest&gt;"));
  assert.ok(!only.includes("Old Maya"));
  assert.ok(!only.includes("maya/dog.png"));

  // Switched-off blogs disappear from it.
  const { id } = await env.DB.prepare("SELECT id FROM users WHERE username = 'sam'").first();
  await archie(`/admin/users/${id}/disabled`, { method: "POST", form: { disabled: "1" } });
  assert.ok(!(await (await reader("/?after-disable")).text()).includes("Sam &lt;Newest&gt;"));
});

test("post fields: set up, auto-numbered, filtered, sorted and shown in feeds", async () => {
  await archie("/admin/users", { method: "POST", form: { username: "june", password: "june-password-1" } });
  const june = browser("11.0.0.1");
  await june("/login", { method: "POST", form: { username: "june", password: "june-password-1" } });
  const defs = (await (await june("/api/fields", { method: "PUT", body: { fields: [
    { name: "emotion", kind: "tags", choices: ["tender", "restless", "hopeful"] },
    { name: "no.", kind: "number", auto: true },
    { name: "written at", kind: "text" },
  ] } })).json()).fields;
  assert.deepEqual(defs.map(d => d.key), ["emotion", "no", "written_at"]);

  const post = async (title, fields, date) =>
    (await (await june("/api/posts", { method: "POST", body: { title, date, fields, published: 1 } })).json()).post;
  const a = await post("first", { emotion: ["tender"], written_at: "the kitchen" }, "2026-01-01");
  const b = await post("second", { emotion: ["restless", "hopeful"] }, "2026-02-01");
  const c = await post("third", { emotion: ["tender", "bogus"], no: 10 }, "2026-03-01");
  assert.deepEqual([a.fields.no, b.fields.no, c.fields.no], [1, 2, 10]); // counts up unless set
  assert.deepEqual(c.fields.emotion, ["tender", "bogus"]); // every tags field takes new tags
  const d = await post("fourth", {}, "2026-04-01");
  assert.equal(d.fields.no, 11);

  const list = async qs => (await (await june(`/june/posts.json?${qs}`)).json()).posts.map(p => p.title);
  assert.deepEqual(await list("filter=emotion:tender"), ["third", "first"]);
  assert.deepEqual(await list("filter=emotion:TENDER&filter=written_at:the%20kitchen"), ["first"]);
  assert.deepEqual(await list("filter=no:2"), ["second"]);
  assert.deepEqual(await list("sort=no"), ["first", "second", "third", "fourth"]);
  assert.deepEqual(await list("sort=-no"), ["fourth", "third", "second", "first"]);

  const data = await (await june("/june/posts.json?x")).json();
  assert.deepEqual(data.user.fields[0], { key: "emotion", name: "emotion", kind: "tags", choices: ["tender", "restless", "hopeful", "bogus"] });
  assert.deepEqual(data.posts.find(p => p.title === "first").fields, { emotion: ["tender"], no: 1, written_at: "the kitchen" });
  assert.match(await (await june("/june/feed.xml?x")).text(), /<category>restless<\/category>/);

  // Removing a field hides its values everywhere.
  await june("/api/fields", { method: "PUT", body: { fields: defs.filter(f => f.key !== "written_at") } });
  assert.deepEqual((await (await june("/june/first.json?y")).json()).post.fields, { emotion: ["tender"], no: 1 });
  assert.match(await (await june("/?fields")).text(), /<a class="kmp-tag" href="\/june\?tag=restless"[^>]*>restless<\/a>/);
});

test("agent keys work like the person, can be revoked, and can't manage keys or passwords", async () => {
  await archie("/admin/users", { method: "POST", form: { username: "ana", password: "ana-password-1" } });
  const ana = browser("12.0.0.1");
  await ana("/login", { method: "POST", form: { username: "ana", password: "ana-password-1" } });
  const { key } = await (await ana("/api/keys", { method: "POST", body: { label: "moving my old blog" } })).json();
  assert.match(key, /^kmp_[A-Za-z0-9_-]{43}$/);

  const agent = (path, opts = {}) =>
    worker.fetch(
      new Request(ORIGIN + path, {
        method: opts.method || "GET",
        headers: { authorization: `Bearer ${opts.key || key}`, "content-type": "application/json", "cf-connecting-ip": "12.0.0.9" },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      }),
      env,
      {}
    );

  // Works without the x-kmp header or a cookie.
  assert.equal((await (await agent("/api/me")).json()).username, "ana");
  assert.equal((await agent("/api/fields", { method: "PUT", body: { fields: [{ name: "series", kind: "tags", choices: ["a", "b"] }] } })).status, 200);
  const made = await agent("/api/posts", { method: "POST", body: { title: "Imported", date: "2019-06-01", body: "old post", published: true, fields: { series: ["b"] } } });
  assert.equal((await made.json()).post.date, "2019-06-01");
  assert.equal((await (await ana("/ana/imported.json?k")).json()).post.fields.series[0], "b");

  // Keys stay with the person.
  assert.equal((await agent("/api/keys")).status, 403);
  assert.equal((await agent("/api/keys", { method: "POST", body: {} })).status, 403);
  assert.equal((await agent("/api/password", { method: "POST", body: { current: "ana-password-1", next: "hijacked-123" } })).status, 403);
  assert.equal((await agent("/api/me", { key: "kmp_" + "x".repeat(43) })).status, 401);

  const keys = (await (await ana("/api/keys")).json()).keys;
  assert.equal(keys[0].label, "moving my old blog");
  assert.ok(keys[0].last_used_at);
  assert.ok(!("token_hash" in keys[0]));

  await ana(`/api/keys/${keys[0].id}`, { method: "DELETE" });
  assert.equal((await agent("/api/me")).status, 401);

  // An admin password reset revokes keys too.
  const { key: key2 } = await (await ana("/api/keys", { method: "POST", body: {} })).json();
  assert.equal((await agent("/api/me", { key: key2 })).status, 200);
  const { id } = await env.DB.prepare("SELECT id FROM users WHERE username = 'ana'").first();
  await archie(`/admin/users/${id}/password`, { method: "POST", form: { password: "" } });
  assert.equal((await agent("/api/me", { key: key2 })).status, 401);
});

test("each blog sees its own costs; deleted files stay on record; admin can add a domain", async () => {
  await archie("/admin/users", { method: "POST", form: { username: "cost-test", password: "cost-password-1" } });
  const me = browser("13.0.0.1");
  await me("/login", { method: "POST", form: { username: "cost-test", password: "cost-password-1" } });
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(996).fill(7)]);
  const up = await me("/api/files?name=a.jpg", { method: "PUT", raw: jpg, headers: { "content-type": "image/jpeg", "content-length": "1000" } });
  const file = (await up.json()).file;
  await me("/api/posts", { method: "POST", body: { title: "words", body: "hello there", published: 1 } });

  let u = await (await me("/api/usage")).json();
  assert.equal(u.stored.files, 1000);
  assert.ok(u.stored.text > 20);
  assert.equal(u.months[0].uploads, 1);
  assert.ok(u.months[0].partial);
  assert.equal(u.allTime.total, 0); // far inside the free allowance
  assert.ok(u.allTime.fullPrice > 0);
  assert.equal(u.domain, null);
  assert.equal(u.hostName, "Reaction Future Institute");

  // Deleting a file: gone from lists, still counted for the time it was stored, name stays taken.
  await me(`/api/files/${file.id}`, { method: "DELETE" });
  assert.equal((await (await me("/api/files")).json()).files.length, 0);
  assert.ok((await env.DB.prepare("SELECT deleted_at FROM files WHERE id = ?").bind(file.id).first()).deleted_at);
  u = await (await me("/api/usage")).json();
  assert.equal(u.stored.files, 0);
  assert.equal(u.months[0].uploads, 1);
  const again = (await (await me("/api/files?name=a.jpg", { method: "PUT", raw: jpg, headers: { "content-type": "image/jpeg", "content-length": "1000" } })).json()).file;
  assert.notEqual(again.key, "cost-test/a.jpg");

  // Archie records a domain paid for through Reaction Future Institute.
  const { id } = await env.DB.prepare("SELECT id FROM users WHERE username = 'cost-test'").first();
  const page = await (await archie(`/admin/users/${id}/domain`, { method: "POST", form: { domain: "Cost-Test.com", cost: "10.44", since: "2024-01-15" } })).text();
  assert.match(page, /cost-test&#39;s domain is cost-test\.com/);
  assert.match(page, /cost, all time/);
  u = await (await me("/api/usage")).json();
  assert.equal(u.domain.name, "cost-test.com");
  assert.equal(u.domain.yearly, 10.44);
  assert.ok(u.allTime.domain >= 20.88); // paid in 2024 and 2025 at least
  assert.equal((await archie(`/admin/users/${id}/domain`, { method: "POST", form: { domain: "nope nope" } })).status, 400);
});

test("costs use Cloudflare's measurements once synced; a failed sync is reported, not fatal", async () => {
  env.BLOG_BUCKET = "blog-cdn-files";
  try {
    // Without a token the sync records why, and costs stay estimated.
    const failed = await archie("/admin/sync-usage", { method: "POST" });
    assert.match(await failed.text(), /CF_ANALYTICS_TOKEN or CF_ACCOUNT_ID isn&#39;t set/);

    const me = browser("14.0.0.1");
    await me("/login", { method: "POST", form: { username: "cost-test", password: "cost-password-1" } });
    let u = await (await me("/api/usage")).json();
    assert.equal(u.months[0].source, "estimated");
    assert.equal(u.measuredThrough, null);
    assert.ok(!("account" in u.months[0])); // account-wide numbers stay on /admin

    // A sync with a token (Cloudflare faked) stores the measurements.
    const today = new Date().toISOString().slice(0, 10);
    const fakeFetch = async () =>
      new Response(JSON.stringify({ data: { viewer: { accounts: [{
        storage: [
          { max: { payloadSize: 5e9, metadataSize: 0 }, dimensions: { date: today, bucketName: "blog-cdn-files" } },
          { max: { payloadSize: 1e8, metadataSize: 0 }, dimensions: { date: today, bucketName: "ear-site" } },
        ],
        ops: [{ sum: { requests: 40 }, dimensions: { date: today, bucketName: "blog-cdn-files", actionType: "GetObject" } }],
      }] } } }));
    const { syncR2Usage } = await import("../src/r2usage.js");
    const s = await syncR2Usage({ ...env, CF_ANALYTICS_TOKEN: "t", CF_ACCOUNT_ID: "a" }, { fetchImpl: fakeFetch });
    assert.equal(s.ok, true);

    u = await (await me("/api/usage")).json();
    assert.equal(u.months[0].source, "measured");
    assert.equal(u.measuredThrough, today);
    const page = await (await archie("/admin")).text();
    assert.match(page, /cloudflare r2, whole account/);
    assert.match(page, new RegExp(`synced through <b>${today}</b>`));
    assert.match(page, /<td>measured<\/td>/);
  } finally {
    delete env.BLOG_BUCKET;
  }
});


test("three wrong passwords lock an account until archie sets a new one", async () => {
  await archie("/admin/users", { method: "POST", form: { username: "lockme", display_name: "Lock Me", password: "right-password-1" } });
  const tries = (password, ip) => browser(ip)("/login", { method: "POST", form: { username: "lockme", password } });

  // Wrong tries warn how many are left (from different places: the lock is per account, not per IP).
  let res = await tries("wrong-1", "15.0.0.1");
  assert.equal(res.status, 401);
  assert.match(await res.text(), /2 more wrong tries and the account locks/);
  // A right password in between resets the count.
  assert.equal((await tries("right-password-1", "15.0.0.2")).status, 303);
  await tries("wrong-2", "15.0.0.3");
  res = await tries("wrong-3", "15.0.0.4");
  assert.match(await res.text(), /1 more wrong try and the account locks/);
  res = await tries("wrong-4", "15.0.0.5");
  assert.equal(res.status, 423);
  assert.match(await res.text(), /text archie to reset your password/);

  // Locked means locked, even with the right password.
  res = await tries("right-password-1", "15.0.0.6");
  assert.equal(res.status, 423);
  assert.match(await res.text(), /text archie to reset your password/);

  // Archie's dashboard flags it; setting a password unlocks it.
  let page = await (await archie("/admin")).text();
  assert.match(page, /<h2>locked out<\/h2>[\s\S]*<b>lockme<\/b>/);
  assert.match(page, /<div class="alert"><dt>locked accounts<\/dt><dd>1<\/dd>/);
  const { id } = await env.DB.prepare("SELECT id FROM users WHERE username = 'lockme'").first();
  page = await (await archie(`/admin/users/${id}/password`, { method: "POST", form: { password: "brand-new-pass-2" } })).text();
  assert.match(page, /their account is unlocked/);
  assert.ok(!page.includes("<h2>locked out</h2>"));
  assert.equal((await tries("right-password-1", "15.0.0.7")).status, 401); // old password is gone
  assert.equal((await tries("brand-new-pass-2", "15.0.0.8")).status, 303);
  const row = await env.DB.prepare("SELECT failed_logins, locked_at FROM users WHERE id = ?").bind(id).first();
  assert.deepEqual(row, { failed_logins: 0, locked_at: null });
});

test("the admin dashboard shows billing for the whole app", async () => {
  const page = await (await archie("/admin")).text();
  assert.match(page, /<dt>whole app, all time<\/dt><dd>\$\d+\.\d\d<\/dd>/);
  assert.match(page, /<h2>billing, whole app<\/h2>/);
  assert.match(page, /running total/);
  // cost-test's domain (paid yearly since 2024-01-15) shows up in the domains column.
  assert.match(page, /<td>all time<\/td><td>[^<]*<\/td><td>\$\d+\.\d\d<\/td>/);
  assert.ok(!page.includes("<td>all time</td><td>$0.00</td><td>$0.00</td>"));
});


test("one-letter usernames work end to end", async () => {
  const page = await (await archie("/admin/users", { method: "POST", form: { username: "b", password: "b-password-123" } })).text();
  assert.match(page, /added b\./);
  const b = browser("16.0.0.1");
  assert.equal((await b("/login", { method: "POST", form: { username: "b", password: "b-password-123" } })).status, 303);
  await b("/api/posts", { method: "POST", body: { title: "hi from b", published: 1 } });
  assert.equal((await b("/b/posts.json?z")).status, 200);
  assert.equal((await b("/b/hi-from-b.json?z")).status, 200);
});

test("open tags grow as posts are written, and the brief list has every post without bodies", async () => {
  await archie("/admin/users", { method: "POST", form: { username: "archietest", password: "archie-password-1" } });
  const a = browser("17.0.0.1");
  await a("/login", { method: "POST", form: { username: "archietest", password: "archie-password-1" } });
  await a("/api/fields", { method: "PUT", body: { fields: [{ name: "tags", kind: "tags", open: true, choices: [] }] } });
  for (let i = 0; i < 60; i++) {
    await a("/api/posts", { method: "POST", body: { title: `post ${i}`, date: `2026-0${1 + (i % 9)}-1${i % 9}`, body: "words ".repeat(50), published: 1, fields: { tags: i % 2 ? ["nyc", "bluegrass"] : ["work"] } } });
  }
  const me = await (await a("/api/me")).json();
  assert.deepEqual(me.fields[0].choices.sort(), ["bluegrass", "nyc", "work"]);

  const full = await (await a("/archietest/posts.json?limit=1000&f")).json();
  assert.equal(full.posts.length, 50); // full posts are still capped
  const brief = await (await a("/archietest/posts.json?brief=1&limit=1000&b")).json();
  assert.equal(brief.posts.length, 60);
  assert.ok(!("html" in brief.posts[0]));
  assert.deepEqual(Object.keys(brief.posts[0]).sort(), ["date", "fields", "slug", "title", "updated", "url"]);
  // The tag list is public in the blog's order, but only tags on published posts.
  assert.deepEqual(brief.user.fields[0], { key: "tags", name: "tags", kind: "tags", choices: ["work", "nyc", "bluegrass"] });
  await a("/api/posts", { method: "POST", body: { title: "draft only", published: 0, fields: { tags: ["unannounced"] } } });
  assert.ok((await (await a("/api/me")).json()).fields[0].choices.includes("unannounced"));
  assert.deepEqual((await (await a("/archietest/posts.json?brief=1&d")).json()).user.fields[0].choices, ["work", "nyc", "bluegrass"]);
  const page2 = await (await a("/archietest/posts.json?brief=1&limit=25&offset=50&o")).json();
  assert.equal(page2.posts.length, 10);
  const tagged = await (await a("/archietest/posts.json?brief=1&limit=1000&filter=tags:nyc&filter=tags:bluegrass&t")).json();
  assert.equal(tagged.posts.length, 30);
});


test("blog pages: /<blog>, #tag feeds, single posts, and tidy 404s", async () => {
  await archie("/admin/users", { method: "POST", form: { username: "tagger", display_name: "Tag Blog!", password: "tagger-password-1" } });
  const t = browser("18.0.0.1");
  await t("/login", { method: "POST", form: { username: "tagger", password: "tagger-password-1" } });
  await t("/api/fields", { method: "PUT", body: { fields: [{ name: "tags", kind: "tags", open: true, choices: [] }, { name: "place", kind: "text" }] } });
  await t("/api/posts", { method: "POST", body: { title: "In NYC", date: "2026-02-02", published: 1, fields: { tags: ["NYC", "bluegrass"], place: "nyc" } } });
  await t("/api/posts", { method: "POST", body: { title: "At Work", date: "2026-02-01", published: 1, fields: { tags: ["work"], place: "nyc" } } });
  await t("/api/posts", { method: "POST", body: { title: "Secret", date: "2026-02-03", published: 0, fields: { tags: ["nyc"] } } });
  const reader = browser("18.0.0.2");

  // The blog's own feed, with archizzl-style #tag links and post links.
  const feed = await (await reader("/tagger?a")).text();
  assert.match(feed, /<title>Tag Blog! · kyle maclachlan photography<\/title>/);
  assert.match(feed, /<a href="\/tagger\/in-nyc">In NYC<\/a>/);
  assert.match(feed, /<a class="kmp-tag" href="\/tagger\?tag=NYC"[^>]*>NYC<\/a>/);
  assert.ok(!feed.includes("Secret"));

  // A tag feed: case doesn't matter, only tags fields count (not the "place" text field), drafts stay out.
  const tagged = await (await reader("/tagger?tag=nyc")).text();
  assert.ok(tagged.includes("In NYC"));
  assert.ok(!tagged.includes("At Work"));
  assert.match(tagged, /showing <a class="tag"[^>]*>#nyc<\/a> <a class="clear" href="\/tagger">\(clear\)<\/a>/);

  // One post on its own, with a way back.
  const one = await (await reader("/tagger/at-work")).text();
  assert.match(one, /<title>At Work · Tag Blog! · /);
  assert.match(one, /← all of Tag Blog!/);
  assert.ok(!one.includes("In NYC"));
  assert.equal((await reader("/tagger/secret")).status, 404); // a draft
  assert.equal((await reader("/tagger/nope")).status, 404);
  assert.equal((await reader("/no-such-blog")).status, 404);

  // The blog's name works too, and goes to the username address.
  const byName = await reader("/tag-blog?tag=work");
  assert.equal(byName.status, 301);
  assert.equal(byName.headers.get("location"), `${ORIGIN}/tagger?tag=work`);
});

test("looks: saved per blog, cleaned, and offered to other blogs (not their own)", async () => {
  await archie("/admin/users", { method: "POST", form: { username: "looker", display_name: "Looker", password: "looker-password-1" } });
  await archie("/admin/users", { method: "POST", form: { username: "borrower", password: "borrower-password-1" } });
  const a = browser("19.0.0.1");
  await a("/login", { method: "POST", form: { username: "looker", password: "looker-password-1" } });
  const b = browser("19.0.0.2");
  await b("/login", { method: "POST", form: { username: "borrower", password: "borrower-password-1" } });

  assert.equal((await (await a("/api/me")).json()).look, null); // nothing saved yet
  const saved = (await (await a("/api/look", { method: "PUT", body: { look: { font: "comic", titleColor: "#ff7eb6", size: "huge", hack: "<script>" } } })).json()).look;
  assert.deepEqual(saved, { font: "comic", titleColor: "#ff7eb6" });
  assert.deepEqual((await (await a("/api/me")).json()).look, saved);

  const forB = (await (await b("/api/looks")).json()).looks;
  assert.deepEqual(forB.find(l => l.username === "looker"), { username: "looker", name: "Looker", look: saved });
  assert.ok(!(await (await a("/api/looks")).json()).looks.some(l => l.username === "looker")); // not your own

  // Clearing it takes the blog off the list.
  await a("/api/look", { method: "PUT", body: { look: {} } });
  assert.ok(!(await (await b("/api/looks")).json()).looks.some(l => l.username === "looker"));
});


test("the agent guide is findable by agents but not shown to people", async () => {
  const res = await browser("20.0.0.1")("/?agents");
  const page = await res.text();
  assert.ok(!/<a [^>]*href="\/agents\.md"/.test(page)); // no visible link
  assert.match(page, /<link rel="alternate" type="text\/markdown"[^>]*href="\/agents\.md">/);
  assert.match(page, /<!-- AI agents: [^>]*agents\.md/);
  assert.match(res.headers.get("link"), /<\/agents\.md>; rel="alternate"/);
});


test("KMP's own pages show each post in its blog's saved look; blogs without one stay plain", async () => {
  await archie("/admin/users", { method: "POST", form: { username: "styled", display_name: "Styled", password: "styled-password-1" } });
  await archie("/admin/users", { method: "POST", form: { username: "plain", password: "plain-password-1" } });
  const st = browser("21.0.0.1");
  await st("/login", { method: "POST", form: { username: "styled", password: "styled-password-1" } });
  await st("/api/posts", { method: "POST", body: { title: "Styled Post", date: "2031-01-02", published: 1 } });
  await st("/api/look", { method: "PUT", body: { look: { font: "comic", titleColor: "#ff7eb6", siteBg: "#fffbea" } } });
  const pl = browser("21.0.0.2");
  await pl("/login", { method: "POST", form: { username: "plain", password: "plain-password-1" } });
  await pl("/api/posts", { method: "POST", body: { title: "Plain Post", date: "2031-01-01", published: 1 } });

  const reader = browser("21.0.0.3");
  for (const path of ["/?mix", "/styled?mix", "/styled/styled-post?mix"]) {
    const page = await (await reader(path)).text();
    assert.match(page, /<style id="looks">[\s\S]*\.kmp-embed\[data-blog="styled"\] \{\n  font-family: "Comic Sans MS"/, path);
    assert.ok(!page.includes("background: #fffbea"), path); // the site stand-in isn't used here: no box behind posts
    assert.match(page, /\.kmp-embed\[data-blog="styled"\] \.kmp-title \{\n  color: #ff7eb6;/, path);
    assert.match(page, /<div class="kmp-embed styled" data-blog="styled">/, path);
  }
  const mixed = await (await reader("/?mix2")).text();
  assert.match(mixed, /<div class="kmp-embed" data-blog="plain">/); // no saved look: plain, no card
  assert.ok(!/data-blog="plain"\] \{/.test(mixed));
  assert.equal((await (await reader("/plain?x")).text()).includes('<style id="looks">'), false);
});

test("preview addresses: offered from the blog name, cleaned when typed, and only preview hostnames count", () => {
  assert.equal(suggestedPreviewName({ username: "bf", display_name: "BRUTE FORCE" }), "bruteforce");
  assert.equal(suggestedPreviewName({ username: "brb", display_name: "brbtime" }), "brbtime");
  assert.equal(suggestedPreviewName({ username: "maya", display_name: "Maya’s Café!" }), "mayascafe");
  assert.equal(suggestedPreviewName({ username: "maya", display_name: "small -- hours" }), "small-hours");
  assert.equal(suggestedPreviewName({ username: "maya", display_name: "🌸" }), "maya");
  assert.equal(suggestedPreviewName({ username: "maya", display_name: "" }), "maya");
  assert.equal(suggestedPreviewName({ username: "x", display_name: "a".repeat(70) }).length, 63);
  const live = { PREVIEW_BASE: "https://{name}.kylemaclachlanphotography.org" };
  assert.deepEqual(cleanPreviewName(live, "  BrbTime "), ["brbtime", null]);
  assert.deepEqual(cleanPreviewName(live, "https://brb-time.kylemaclachlanphotography.org/"), ["brb-time", null]);
  assert.match(cleanPreviewName(live, "brb time")[1], /letters, numbers and hyphens/);
  assert.match(cleanPreviewName(live, "-brb")[1], /can't start or end with a hyphen/);
  assert.match(cleanPreviewName(live, "")[1], /Type an address/);
  assert.match(cleanPreviewName(live, "a".repeat(64))[1], /too long/);
  assert.deepEqual(cleanPreviewName({ PREVIEW_BASE: "http://{name}.localhost:8129" }, "maya.localhost"), ["maya", null]);
  assert.equal(nameFromHost(live, "brute-force.kylemaclachlanphotography.org"), "brute-force");
  assert.equal(nameFromHost(live, "kylemaclachlanphotography.org"), null);
  assert.equal(nameFromHost(live, "cdn.kylemaclachlanphotography.org"), null);
  assert.equal(nameFromHost(live, "www.kylemaclachlanphotography.org"), null);
  assert.equal(nameFromHost(live, "a.b.kylemaclachlanphotography.org"), null);
  assert.equal(nameFromHost(live, "brute-force.example.com"), null);
  assert.equal(nameFromHost({ PREVIEW_BASE: "http://{name}.localhost:8129" }, "maya.localhost"), "maya");
});

test("preview sites: friends pick the address, renames don't move it, one blog per address", async () => {
  const PREVIEW_ENV = () => ({ ...env, SITE_ORIGIN: ORIGIN });
  const visit = (host, path = "/") => previews.fetch(new Request(`https://${host}.kylemaclachlanphotography.org${path}`), PREVIEW_ENV());
  await archie("/admin/users", { method: "POST", form: { username: "bf", display_name: "Loud Band", password: "bf-password-123" } });
  await archie("/admin/users", { method: "POST", form: { username: "other", display_name: "Other", password: "other-password-1" } });
  const bf = browser("22.0.0.1");
  await bf("/login", { method: "POST", form: { username: "bf", password: "bf-password-123" } });
  await bf("/api/fields", { method: "PUT", body: { fields: [{ name: "tags", kind: "tags", open: true, choices: [] }] } });
  await bf("/api/posts", { method: "POST", body: { title: "First Riff", date: "2032-01-02", published: 1, fields: { tags: ["loud"] } } });
  await bf("/api/posts", { method: "POST", body: { title: "Quiet One", date: "2032-01-01", published: 1, fields: { tags: ["soft"] } } });
  await bf("/api/posts", { method: "POST", body: { title: "Draft Riff", date: "2032-01-03", published: 0 } });

  // Off to start with: settings offers an address from the blog name, and nothing is served there.
  let me = await (await bf("/api/me")).json();
  assert.equal(me.preview, null);
  assert.equal(me.previewName, "loudband");
  assert.equal(me.previewDomain, ".kylemaclachlanphotography.org");
  assert.equal((await visit("loudband")).status, 404);

  // On, at an address they pick (typed loosely).
  me = await (await bf("/api/preview", { method: "PUT", body: { on: true, name: " Loud-Band " } })).json();
  assert.equal(me.preview, "https://loud-band.kylemaclachlanphotography.org");
  assert.equal(me.previewName, "loud-band");
  const home = await visit("loud-band");
  assert.equal(home.status, 200);
  assert.equal(home.headers.get("x-robots-tag"), "noindex");
  const page = await home.text();
  assert.match(page, /<title>Loud Band<\/title>/);
  assert.match(page, /<h1><a href="\/">Loud Band<\/a><\/h1>/);
  assert.match(page, /<a href="\/first-riff">First Riff<\/a>/);
  assert.match(page, /<a class="kmp-tag" href="\/\?tag=loud"/);
  assert.match(page, /href="https:\/\/kylemaclachlanphotography\.org\/app\/home\.css"/);
  assert.ok(!page.includes("Draft Riff"));
  assert.ok(!page.includes("log in")); // no front page sidebar, no other blogs
  assert.ok(!page.includes("Other"));
  const one = await (await visit("loud-band", "/quiet-one")).text();
  assert.match(one, /<title>Quiet One · Loud Band<\/title>/);
  assert.match(one, /<a href="\/">← all of Loud Band<\/a>/);
  const tagged = await (await visit("loud-band", "/?tag=soft")).text();
  assert.ok(tagged.includes("Quiet One") && !tagged.includes("First Riff"));
  assert.equal((await visit("loud-band", "/draft-riff")).status, 404);
  assert.equal((await visit("loud-band", "/a/b")).status, 404);
  assert.match(await (await visit("loud-band", "/robots.txt")).text(), /Disallow: \//);

  // Renaming the blog leaves the address alone.
  await bf("/api/me", { method: "PUT", body: { display_name: "Quiet Band", site_url: "", post_url_pattern: "" } });
  me = await (await bf("/api/me")).json();
  assert.equal(me.preview, "https://loud-band.kylemaclachlanphotography.org");
  assert.match(await (await visit("loud-band")).text(), /<title>Quiet Band<\/title>/);

  // Bad addresses, taken ones and official-looking ones are refused.
  const o = browser("22.0.0.2");
  await o("/login", { method: "POST", form: { username: "other", password: "other-password-1" } });
  for (const [name, why] of [["loud-band", /already uses loud-band\.kylemaclachlanphotography\.org/], ["cdn", /can't be a preview address/], ["two words", /letters, numbers and hyphens/]]) {
    const res = await o("/api/preview", { method: "PUT", body: { on: true, name } });
    assert.equal(res.status, 400, name);
    assert.match((await res.json()).error, why, name);
  }
  assert.equal((await (await o("/api/me")).json()).preview, null);
  // Without a name, it takes the offered one.
  assert.equal((await (await o("/api/preview", { method: "PUT", body: { on: true } })).json()).preview, "https://other.kylemaclachlanphotography.org");

  // Changing the address moves it; the old one stops working and is free again.
  me = await (await bf("/api/preview", { method: "PUT", body: { on: true, name: "brbtime" } })).json();
  assert.equal(me.preview, "https://brbtime.kylemaclachlanphotography.org");
  assert.equal((await visit("loud-band")).status, 404);
  assert.match(await (await visit("brbtime")).text(), /<title>Quiet Band<\/title>/);
  assert.equal((await o("/api/preview", { method: "PUT", body: { on: true, name: "loud-band" } })).status, 200);
  // Turning on again without a name keeps the address it has.
  assert.equal((await (await bf("/api/preview", { method: "PUT", body: { on: true } })).json()).preview, "https://brbtime.kylemaclachlanphotography.org");

  // A disabled blog's preview goes away with it; turning it off frees the address.
  const bfId = (await env.DB.prepare("SELECT id FROM users WHERE username = 'bf'").first()).id;
  await archie(`/admin/users/${bfId}/disabled`, { method: "POST", form: { disabled: "1" } });
  assert.equal((await visit("brbtime")).status, 404);
  await env.DB.prepare("UPDATE users SET disabled = 0 WHERE id = ?").bind(bfId).run();
  await bf("/login", { method: "POST", form: { username: "bf", password: "bf-password-123" } });
  me = await (await bf("/api/preview", { method: "PUT", body: { on: false } })).json();
  assert.equal(me.preview, null);
  assert.equal((await visit("brbtime")).status, 404);
});

test("bruteforce.: the hand-made photo site, newest photos first", async () => {
  const visit = (host, path = "/") => previews.fetch(new Request(`https://${host}.kylemaclachlanphotography.org${path}`), { ...env, SITE_ORIGIN: ORIGIN });
  await archie("/admin/users", { method: "POST", form: { username: "bruteforce", display_name: "BRUTE FORCE", password: "bruteforce-pass-1" } });
  const id = (await env.DB.prepare("SELECT id FROM users WHERE username = 'bruteforce'").first()).id;
  const add = (name, at, extra = "") =>
    env.DB.prepare(`INSERT INTO files (user_id, key, name, content_type, size, created_at${extra ? ", deleted_at" : ""}) VALUES (?, ?, ?, ?, 1, ?${extra ? ", ?" : ""})`)
      .bind(id, `bruteforce/${name}`, name, name.endsWith(".pdf") ? "application/pdf" : "image/jpeg", at, ...(extra ? [extra] : []))
      .run();
  await add("old.jpg", "2032-01-01T00:00:00Z");
  await add("new.jpg", "2032-01-03T00:00:00Z");
  await add("mid.jpg", "2032-01-02T00:00:00Z");
  await add("gone.jpg", "2032-01-04T00:00:00Z", "2032-01-05T00:00:00Z");
  await add("zine.pdf", "2032-01-04T00:00:00Z");

  const res = await visit("bruteforce");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-robots-tag"), "noindex");
  const page = await res.text();
  assert.match(page, /<title>BRUTE FORCE<\/title>/);
  assert.match(page, /#E7BBD8/);
  assert.match(page, new RegExp(`<img class="left" src="${CDN}/bruteforce/new\\.jpg" alt=""><img class="right" src="${CDN}/bruteforce/mid\\.jpg"`));
  const row = [...page.matchAll(/data-i="\d+"[^>]*><img src="[^"]*\/([^"/]+)"/g)].map(m => m[1]);
  assert.deepEqual(row, ["new.jpg", "mid.jpg", "old.jpg"]); // no deleted files, no PDFs
  assert.equal((await visit("bruteforce", "/anything")).status, 404);

  // No blog's preview can take the address.
  const b = browser("22.0.0.9");
  await b("/login", { method: "POST", form: { username: "bruteforce", password: "bruteforce-pass-1" } });
  await b("/api/me", { method: "PUT", body: { display_name: "bruteforce", site_url: "", post_url_pattern: "" } });
  assert.equal((await b("/api/preview", { method: "PUT", body: { on: true } })).status, 400);
  assert.equal((await visit("bruteforce")).status, 200);
});

test("hidden tags: their posts stay out of lists and feeds unless the tag is asked for", async () => {
  await archie("/admin/users", { method: "POST", form: { username: "hider", display_name: "Hider", password: "hider-password-1" } });
  const h = browser("23.0.0.1");
  await h("/login", { method: "POST", form: { username: "hider", password: "hider-password-1" } });
  // Hidden tags must be among the choices and take their spelling.
  const saved = await (
    await h("/api/fields", { method: "PUT", body: { fields: [{ name: "tags", kind: "tags", open: true, choices: ["Secret", "nyc"], hidden: ["secret", "not-a-tag"] }] } })
  ).json();
  assert.deepEqual(saved.fields[0].hidden, ["Secret", "not-a-tag"]);
  await h("/api/posts", { method: "POST", body: { title: "Part One", date: "2033-01-01", published: 1, fields: { tags: ["secret"] } } });
  await h("/api/posts", { method: "POST", body: { title: "Part Two", date: "2033-01-02", published: 1, fields: { tags: ["nyc", "Secret"] } } });
  await h("/api/posts", { method: "POST", body: { title: "Out Loud", date: "2033-01-03", published: 1, fields: { tags: ["nyc"] } } });
  const reader = browser("23.0.0.2");
  const has = (text, ...titles) => titles.every(t => text.includes(t));
  const none = (text, ...titles) => titles.every(t => !text.includes(t));

  // The blog's page and the front page leave them out.
  const blog = await (await reader("/hider")).text();
  assert.ok(has(blog, "Out Loud") && none(blog, "Part One", "Part Two"));
  assert.ok(none(await (await reader("/?hidden")).text(), "Part One", "Part Two"));
  // Asking for the tag (any case) shows them; asking for another tag doesn't.
  const secret = await (await reader("/hider?tag=SECRET")).text();
  assert.ok(has(secret, "Part One", "Part Two") && none(secret, "Out Loud"));
  const nyc = await (await reader("/hider?tag=nyc")).text();
  assert.ok(has(nyc, "Out Loud") && none(nyc, "Part Two"));
  // Each post's own page still works.
  assert.equal((await reader("/hider/part-one")).status, 200);
  assert.equal((await reader("/hider/part-one.json")).status, 200);

  // posts.json, embeds and feeds: the same.
  const titles = async q => (await (await reader(`/hider/posts.json${q}`)).json()).posts.map(p => p.title);
  assert.deepEqual(await titles("?a"), ["Out Loud"]);
  assert.deepEqual(await titles("?brief=1"), ["Out Loud"]);
  assert.deepEqual(await titles("?filter=tags:secret"), ["Part Two", "Part One"]);
  assert.deepEqual(await titles("?filter=tags:nyc"), ["Out Loud"]);
  assert.deepEqual(await titles("?filter=tags:nyc&filter=tags:secret"), ["Part Two"]);
  assert.ok(none(await (await reader("/hider/feed.xml")).text(), "Part One"));
  assert.ok(none(await (await reader("/hider/feed.json")).text(), "Part One"));
  assert.ok(has(await (await reader("/hider/feed.json?filter=tags:secret")).text(), "Part One"));

  // A preview site too.
  await h("/api/preview", { method: "PUT", body: { on: true, name: "hider" } });
  const visit = path => previews.fetch(new Request(`https://hider.kylemaclachlanphotography.org${path}`), { ...env, SITE_ORIGIN: ORIGIN });
  assert.ok(none(await (await visit("/")).text(), "Part One"));
  assert.ok(has(await (await visit("/?tag=secret")).text(), "Part One", "Part Two"));
  assert.equal((await visit("/part-two")).status, 200);

  // Unhiding brings them back.
  await h("/api/fields", { method: "PUT", body: { fields: [{ ...saved.fields[0], hidden: [] }] } });
  assert.ok(has(await (await reader("/hider?again")).text(), "Part One", "Part Two", "Out Loud"));
});

test("sign-ups: a request waits for archie, who accepts (account + front page photo) or denies (photo deleted)", async () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const form = (fields, photo = new File([JPEG], "kyle.jpg", { type: "image/jpeg" })) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    if (photo) f.set("photo", photo);
    return f;
  };
  const visitor = browser("24.0.0.1");
  assert.match(await (await visitor("/signup")).text(), /your favorite photo of kyle maclachlan/);

  // Problems come back on the form (or as JSON for signup.js).
  const short = await visitor("/signup", { method: "POST", raw: form({ first_name: "Dale", blog_name: "Coffee Log", password: "short" }) });
  assert.equal(short.status, 400);
  assert.match(await short.text(), /at least 8 characters/);
  const fake = await visitor("/signup", {
    method: "POST",
    raw: form({ first_name: "Dale", blog_name: "Coffee Log", password: "damn-fine-coffee" }, new File(["<svg/>"], "kyle.jpg", { type: "image/jpeg" })),
    headers: { accept: "application/json" },
  });
  assert.equal(fake.status, 400);
  assert.match((await fake.json()).error, /doesn't look like a photo/);
  // Bots fill in the hidden field: they're told thanks, and nothing is kept.
  await visitor("/signup", { method: "POST", raw: form({ first_name: "Bot", blog_name: "Spam", password: "spam-spam-spam", website: "x" }) });
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM signups WHERE first_name = 'Bot'").first()).n, 0);

  // A good request: the username comes from the blog name.
  const ok = await visitor("/signup", { method: "POST", raw: form({ first_name: "Dale", blog_name: "Coffee Log!", password: "damn-fine-coffee", width: "800", height: "1000" }) });
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /username: <b>coffeelog<\/b>/);
  const row = await env.DB.prepare("SELECT * FROM signups WHERE username = 'coffeelog'").first();
  assert.match(row.photo_key, /^_kyle\/[0-9a-f-]{36}\.jpg$/);
  assert.match(row.password_hash, /^pbkdf2\$/);
  assert.ok(await env.FILES.get(row.photo_key));
  // A second request with the same blog name gets the next username.
  const other = browser("24.0.0.2");
  const two = await other("/signup", { method: "POST", raw: form({ first_name: "Audrey", blog_name: "coffee log", password: "cherry-pie-123" }), headers: { accept: "application/json" } });
  assert.deepEqual(await two.json(), { username: "coffeelog-2", firstName: "Audrey" });

  // Logging in before it's accepted says it's waiting.
  const dale = browser("24.0.0.3");
  const early = await dale("/login", { method: "POST", form: { username: "coffeelog", password: "damn-fine-coffee" } });
  assert.equal(early.status, 403);
  assert.match(await early.text(), /still waiting for Archie/);

  // Archie sees both, with their photos.
  const admin = await (await archie("/admin")).text();
  assert.match(admin, /<h2>sign-up requests<\/h2>/);
  assert.match(admin, /<b>Dale<\/b> wants <b>Coffee Log!<\/b>/);
  assert.ok(admin.includes(`${CDN}/${row.photo_key}`));

  // The front page has no Kyle photos yet.
  assert.ok(!(await (await visitor("/?k0")).text()).includes('class="kyle"'));

  // Accept Dale (under a different username): the account works with Dale's own password.
  const id2 = (await env.DB.prepare("SELECT id FROM signups WHERE username = 'coffeelog-2'").first()).id;
  const taken = await archie(`/admin/signups/${row.id}/accept`, { method: "POST", form: { username: "coffeelog-2" } });
  assert.equal(taken.status, 400); // Audrey's request is waiting with that one
  const accepted = await (await archie(`/admin/signups/${row.id}/accept`, { method: "POST", form: { username: "dale" } })).text();
  assert.match(accepted, /accepted Dale as dale\./);
  const user = await env.DB.prepare("SELECT * FROM users WHERE username = 'dale'").first();
  assert.equal(user.display_name, "Coffee Log!");
  assert.equal(user.first_name, "Dale");
  assert.equal((await env.DB.prepare("SELECT password_hash FROM signups WHERE id = ?").bind(row.id).first()).password_hash, "");
  assert.equal((await dale("/login", { method: "POST", form: { username: "dale", password: "damn-fine-coffee" } })).headers.get("location"), "/dashboard");
  assert.equal((await archie(`/admin/signups/${row.id}/accept`, { method: "POST", form: {} })).status, 400); // already decided

  // Dale's photo is now above the front page's title.
  const front = await (await visitor("/?k1")).text();
  assert.match(front, new RegExp(`<img class="kyle" src="${CDN}/${row.photo_key}" alt="kyle maclachlan, picked by Dale" width="800" height="1000" data-kyle=`));
  assert.ok(front.indexOf('class="kyle"') < front.indexOf("kyle maclachlan photography</a></h1>"));

  // Deny Audrey: the photo is deleted and the username is free again.
  const audreyKey = (await env.DB.prepare("SELECT photo_key FROM signups WHERE id = ?").bind(id2).first()).photo_key;
  assert.match(await (await archie(`/admin/signups/${id2}/deny`, { method: "POST", form: {} })).text(), /denied Audrey/);
  assert.equal(await env.FILES.get(audreyKey), null);
  assert.ok(!(await (await archie("/admin")).text()).includes("<h2>sign-up requests</h2>"));
  assert.equal((await other("/login", { method: "POST", form: { username: "coffeelog-2", password: "cherry-pie-123" } })).status, 401);

  // Three requests a day from one place, at most.
  const busy = browser("24.0.0.9");
  for (let i = 0; i < 3; i++) await busy("/signup", { method: "POST", raw: form({ first_name: `F${i}`, blog_name: `Blog ${i}`, password: "password-123" }) });
  assert.equal((await busy("/signup", { method: "POST", raw: form({ first_name: "F4", blog_name: "Blog 4", password: "password-123" }) })).status, 429);
});
