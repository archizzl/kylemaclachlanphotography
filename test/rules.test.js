// Run with `npm test`. The parts that keep friends' pages safe and their addresses tidy.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, excerpt } from "../src/markdown.js";
import { checkUpload, cleanFileText, cleanPost, cleanSettings, contentMatches, safeFileName, slugify, usernameProblem } from "../src/rules.js";
import { checkPassword, generatePassword, hashPassword, passwordProblem } from "../src/auth.js";
import { jsonFeed, rssFeed } from "../src/feeds.js";

test("typed HTML is shown as text, never run", () => {
  const out = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n<iframe src="https://evil"></iframe>');
  assert.ok(!out.includes("<script"));
  assert.ok(!out.includes("<img"));
  assert.ok(!out.includes("<iframe"));
  assert.ok(out.includes("&lt;script&gt;"));
});

test("dangerous links don't become links", () => {
  for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "vbscript:x", "data:text/html,<b>x</b>"]) {
    assert.ok(!renderMarkdown(`[click](${href})`).includes("<a"), href);
  }
  assert.ok(!renderMarkdown("![x](javascript:alert(1))").includes("<img"));
});

test("markdown basics render", () => {
  const out = renderMarkdown("Hi **there** [site](https://a.org)\n\n- one\n- two\n\n## Next\n\n![a tree](https://cdn.x/u/tree.jpg)");
  assert.match(out, /<strong>there<\/strong>/);
  assert.match(out, /<a href="https:\/\/a.org" rel="noopener">site<\/a>/);
  assert.match(out, /<ul>\n<li>one<\/li>/);
  assert.match(out, /<h2>Next<\/h2>/);
  assert.match(out, /<img src="https:\/\/cdn.x\/u\/tree.jpg" alt="a tree" loading="lazy">/);
  assert.match(renderMarkdown("see https://example.org"), /href="https:\/\/example.org"/);
});

test("a single Enter is a line break (poems keep their shape)", () => {
  assert.equal(renderMarkdown("one\ntwo\n\nthree"), "<p>one<br>\ntwo</p>\n<p>three</p>\n");
});

test("archizzl-style extras: [[box]], ++underline++, ~~strike~~, and text exactly as typed", () => {
  assert.equal(renderMarkdown('[["No ***Q*** train"]]'), '<p><span class="box">&quot;No <em><strong>Q</strong></em> train&quot;</span></p>\n');
  assert.equal(renderMarkdown("No ++habia servicio++ here"), "<p>No <u>habia servicio</u> here</p>\n");
  assert.equal(renderMarkdown("~~gone~~"), "<p><s>gone</s></p>\n");
  assert.equal(renderMarkdown('a -- b "c" (c)'), "<p>a -- b &quot;c&quot; (c)</p>\n"); // no smart dashes/quotes
  assert.equal(renderMarkdown("[[open and ++open"), "<p>[[open and ++open</p>\n");
  assert.ok(!renderMarkdown("[[<script>x</script>]]").includes("<script")); // still escaped inside
});

test("excerpt strips formatting and shortens", () => {
  assert.equal(excerpt("**Bold** and [a link](https://x.org) ![pic](y.jpg)"), "Bold and a link");
  assert.ok(excerpt("word ".repeat(200)).endsWith("…"));
});

test("passwords hash, verify and reject wrong ones", async () => {
  const h = await hashPassword("correct horse");
  assert.match(h, /^pbkdf2\$100000\$/);
  assert.equal(await checkPassword("correct horse", h), true);
  assert.equal(await checkPassword("wrong horse", h), false);
  assert.equal(await checkPassword("anything", undefined), false);
  assert.notEqual(await hashPassword("same"), await hashPassword("same")); // salted
  assert.ok(passwordProblem("short"));
  assert.equal(passwordProblem("long enough"), null);
  assert.match(generatePassword(), /^[a-z]+-[a-z]+-\d{4}$/);
});

test("usernames are URL-safe and can't shadow site paths", () => {
  assert.equal(usernameProblem("maya"), null);
  assert.equal(usernameProblem("b"), null); // one letter is fine
  assert.equal(usernameProblem("dj-fox-2"), null);
  for (const bad of ["", "-", "Maya", "-maya", "maya-", "ma ya", "maya/x", "admin", "api", "login", "_cdn", "x".repeat(31)]) {
    assert.ok(usernameProblem(bad), bad);
  }
});

test("posts need a title and get a clean address", () => {
  assert.ok(cleanPost({ title: "  " })[1]);
  const [p] = cleanPost({ title: "Café Days: Part 1!", date: "nope", body: "x" });
  assert.equal(p.slug, "cafe-days-part-1");
  assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(cleanPost({ title: "x", slug: "My Own Slug" })[0].slug, "my-own-slug");
  assert.equal(cleanPost({ title: "posts" })[0].slug, "posts-post");
  assert.equal(cleanPost({ title: "Feed" })[0].slug, "feed-post");
  assert.equal(cleanPost({ title: "!!!" })[0].slug, "post");
  assert.equal(slugify("It’s a dog's life"), "its-a-dogs-life");
});

test("settings only take web addresses, and the pattern needs {slug}", () => {
  assert.ok(cleanSettings({ site_url: "javascript:alert(1)" })[1]);
  assert.ok(cleanSettings({ post_url_pattern: "https://me.org/blog/" })[1]);
  assert.ok(cleanSettings({ post_url_pattern: "ftp://me.org/{slug}" })[1]);
  const [s] = cleanSettings({ display_name: " Maya ", site_url: "https://maya.neocities.org", post_url_pattern: "https://maya.neocities.org/b/{slug}" });
  assert.equal(s.display_name, "Maya");
  assert.equal(s.post_url_pattern, "https://maya.neocities.org/b/{slug}");
});

test("uploads: allowed types only, SVG and HTML refused, 25 MB cap", () => {
  assert.equal(checkUpload("Photo.JPG", 10)[0].type, "image/jpeg");
  assert.equal(checkUpload("notes.md", 10)[0].type, "text/markdown; charset=utf-8");
  for (const bad of ["logo.svg", "page.html", "page.htm", "x.js", "x.xhtml", "noext"]) assert.ok(checkUpload(bad, 10)[1], bad);
  assert.ok(checkUpload("big.jpg", 26 * 1024 * 1024)[1]);
  assert.ok(checkUpload("empty.jpg", 0)[1]);
});

test("file names are made URL-safe and keep their extension", () => {
  assert.equal(safeFileName("My Photo (1).JPG"), "my-photo-1.jpg");
  assert.equal(safeFileName("../../etc/passwd.txt"), "passwd.txt");
  assert.equal(safeFileName("Ünïcödé.png"), "unicode.png");
  assert.equal(safeFileName(".png"), "png"); // dotfile: no extension, so it gets refused
});

test("file contents must match their extension", () => {
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const htmlBytes = new TextEncoder().encode("<html><script>alert(1)</script>");
  assert.equal(contentMatches("image/jpeg", jpg), true);
  assert.equal(contentMatches("image/jpeg", htmlBytes), false);
  assert.equal(contentMatches("image/png", htmlBytes), false);
  assert.equal(contentMatches("application/pdf", new TextEncoder().encode("%PDF-1.7")), true);
});

test("feeds have the right shape and escape their contents", () => {
  const user = { username: "maya", display_name: "Maya & Co", site_url: "https://maya.org", post_url_pattern: "https://maya.org/p/{slug}" };
  const posts = [{ id: 1, slug: "hi", title: "Hi <there>", date: "2026-11-20", body_md: "hello", body_html: "<p>hello</p>", updated_at: "2026-11-20T00:00:00Z" }];
  const opts = { origin: "https://kmp.test", cdnBase: "https://cdn.kmp.test" };
  const rss = rssFeed(user, posts, opts);
  assert.match(rss, /<rss version="2.0"/);
  assert.match(rss, /<title>Maya &amp; Co<\/title>/);
  assert.match(rss, /<title>Hi &lt;there&gt;<\/title>/);
  assert.match(rss, /<link>https:\/\/maya.org\/p\/hi<\/link>/);
  assert.match(rss, /<description>&lt;p&gt;hello&lt;\/p&gt;<\/description>/);
  const jf = jsonFeed(user, posts, opts);
  assert.equal(jf.version, "https://jsonfeed.org/version/1.1");
  assert.equal(jf.items[0].url, "https://maya.org/p/hi");
  assert.equal(jf.items[0].content_html, "<p>hello</p>");
  // Without a pattern, links go to the post's .md file.
  assert.equal(jsonFeed({ ...user, post_url_pattern: "" }, posts, opts).items[0].url, "https://cdn.kmp.test/maya/posts/hi.md");
});

test("alt text and captions are trimmed to one line", () => {
  assert.deepEqual(cleanFileText({ alt: " a\n dog ", caption: "x".repeat(2000) }), { alt: "a dog", caption: "x".repeat(2000) });
  assert.deepEqual(cleanFileText(null), { alt: "", caption: "" });
});
