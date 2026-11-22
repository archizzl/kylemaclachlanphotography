// Moves archizzl.com's blog (~/dev/archizzl.github.io/blog) onto KMP, through the same API and
// agent key any agent would use (see public/agents.md).
//
//   KMP_AGENT_KEY=kmp_… node scripts/import-archizzl.mjs                       # against production
//   KMP_AGENT_KEY=kmp_… BASE=http://localhost:8127 node scripts/import-archizzl.mjs
//   … --dry-run   prints the converted posts without sending anything
//
// - blog/src/*.txt become published posts, blog/drafts/*.txt stay drafts (a "status:" line wins).
// - Slugs and dates are kept. Tags go into an open "tags" field. Running it again updates posts
//   with the same slug instead of adding copies.
// - archizzl's text format is converted to KMP's: __underline__ -> ++underline++,
//   --strike-- -> ~~strike~~, raw <img> blocks -> markdown images, # headings -> ##. [[box]],
//   **bold**, *italic* and [links](…) are the same in both.
// - Images in blog/images/ are uploaded, and references to them are pointed at the CDN copy.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { homedir } from "node:os";

const BASE = (process.env.BASE || "https://kylemaclachlanphotography.org").replace(/\/+$/, "");
const KEY = process.env.KMP_AGENT_KEY;
const DRY = process.argv.includes("--dry-run");
const BLOG = process.env.ARCHIZZL_BLOG || join(homedir(), "dev/archizzl.github.io/blog");
const SITE = "https://archizzl.com";

// ---- reading archizzl's files (same rules as its build.py) ----

function parseSource(text, file) {
  const i = text.indexOf("---");
  if (i < 0) throw new Error(`${file}: missing '---' between front matter and body`);
  const meta = {};
  for (const line of text.slice(0, i).split("\n")) {
    if (!line.trim()) continue;
    const c = line.indexOf(":");
    if (c < 0) throw new Error(`${file}: bad front matter line ${JSON.stringify(line)}`);
    meta[line.slice(0, c).trim().toLowerCase()] = line.slice(c + 1).trim();
  }
  return { meta, body: text.slice(i + 3).trim() };
}

function readPosts() {
  const out = [];
  for (const [dir, published] of [["src", true], ["drafts", false]]) {
    const path = join(BLOG, dir);
    if (!existsSync(path)) continue;
    for (const name of readdirSync(path).filter(n => n.endsWith(".txt") && n !== "template.txt").sort()) {
      const { meta, body } = parseSource(readFileSync(join(path, name), "utf8"), `${dir}/${name}`);
      const status = (meta.status || "").toLowerCase();
      const slug = name.replace(/\.txt$/, "");
      out.push({
        slug,
        title: meta.title || slug.replace(/-/g, " "),
        date: meta.date,
        description: meta.description || "",
        tags: (meta.tags || "").split(",").map(t => t.trim()).filter(Boolean),
        published: status === "live" ? true : status === "draft" ? false : published,
        body,
      });
    }
  }
  return out;
}

// ---- archizzl text -> KMP markdown ----

const attr = (tag, name) => (tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i")) || tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, "i")) || [])[1];

// A line that archizzl shows as plain text but markdown would read as a list, quote, heading or
// code block gets a backslash (or loses its indent) so it stays plain text.
function keepPlain(line) {
  const t = line.replace(/^\s{4,}/, "");
  if (/^\d+[.)]\s/.test(t)) return t.replace(/^(\d+)([.)])/, "$1\\$2"); // 1. -> 1\.
  if (/^([-+]\s|\*\s|>|#)/.test(t)) return "\\" + t;
  return t;
}

export function convertBody(body, imageMap = {}, warnings = []) {
  const blocks = body.trim().split(/\n\s*\n/);
  const out = [];
  for (let block of blocks) {
    block = block.trim();
    if (!block) continue;
    for (const [from, to] of Object.entries(imageMap)) block = block.split(from).join(to);
    if (block.startsWith("<") && block.endsWith(">")) {
      // Raw HTML: KMP shows HTML as text, so images become markdown images.
      const imgs = block.match(/<img\b[^>]*>/gi) || [];
      const rest = block.replace(/<img\b[^>]*>/gi, "").replace(/<\/?[^>]+>/g, "").trim();
      for (const tag of imgs) {
        const src = attr(tag, "src");
        if (src) out.push(`![${(attr(tag, "alt") || "").replace(/[[\]]/g, "")}](${src.replace(/ /g, "%20")})`);
      }
      if (rest) out.push(rest);
      if (!imgs.length || rest) warnings.push(`raw HTML turned into text: ${block.slice(0, 80)}`);
      continue;
    }
    if (/^#{1,6}\s/.test(block)) {
      out.push("## " + block.replace(/^#{1,6}\s+/, ""));
      continue;
    }
    const text = block
      .split("\n")
      .map(keepPlain)
      .join("\n")
      .replace(/__(.+?)__/g, "++$1++") // archizzl underline
      .replace(/--(\S.*?\S|\S)--/g, "~~$1~~"); // archizzl strikethrough
    out.push(text);
  }
  return out.join("\n\n");
}

// ---- talking to KMP ----

async function api(path, { method = "GET", body, headers = {}, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${KEY}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${data.error || res.status}`);
  return data;
}

const TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };

async function main() {
  if (!KEY && !DRY) throw new Error("Set KMP_AGENT_KEY (make one in the KMP dashboard: settings → let an AI agent set up your blog).");
  const posts = readPosts();
  const warnings = [];

  if (DRY) {
    for (const p of posts) {
      console.log(`\n===== ${p.slug} (${p.published ? "published" : "draft"}, ${p.date}, tags: ${p.tags.join(", ") || "none"})\n${convertBody(p.body, {}, warnings)}`);
    }
    if (warnings.length) console.log("\nwarnings:\n- " + warnings.join("\n- "));
    return;
  }

  const me = await api("/api/me");
  console.log(`importing into ${BASE} as ${me.username}`);

  // Blog settings: the blog's name and where posts live on archizzl.com.
  await api("/api/me", { method: "PUT", body: { display_name: me.display_name || "archie", site_url: SITE, post_url_pattern: `${SITE}/blog/post/?p={slug}` } });

  // An open "tags" field (any tag can be typed), plus "description" if any post has one.
  const fields = me.fields.filter(f => f.key !== "tags" && f.key !== "description");
  const tagsField = me.fields.find(f => f.key === "tags") || { name: "tags", kind: "tags", choices: [] };
  const allTags = [...new Set([...(tagsField.choices || []), ...posts.flatMap(p => p.tags)])];
  const next = [{ ...tagsField, kind: "tags", open: true, choices: allTags }, ...fields];
  if (posts.some(p => p.description)) next.push(me.fields.find(f => f.key === "description") || { name: "description", kind: "text" });
  await api("/api/fields", { method: "PUT", body: { fields: next } });

  // Images: upload each once (skipping ones already there) and remember their new address.
  const imageMap = {};
  const imgDir = join(BLOG, "images");
  const existing = (await api("/api/files")).files;
  if (existsSync(imgDir)) {
    for (const name of readdirSync(imgDir).filter(n => TYPES[extname(n).toLowerCase()])) {
      const already = existing.find(f => f.name === name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-"));
      const file = already || (await api(`/api/files?name=${encodeURIComponent(name)}`, { method: "PUT", raw: readFileSync(join(imgDir, name)), headers: { "content-type": TYPES[extname(name).toLowerCase()] } })).file;
      for (const ref of [`${SITE}/blog/images/${name}`, `/blog/images/${name}`, `../../images/${name}`, `../images/${name}`]) imageMap[ref] = file.url;
      console.log(`image ${name}: ${already ? "already there" : "uploaded"} → ${file.url}`);
    }
  }

  // Posts: create, or update the one with the same slug.
  const current = (await api("/api/posts")).posts;
  for (const p of posts) {
    const payload = {
      title: p.title,
      slug: p.slug,
      date: p.date,
      body: convertBody(p.body, imageMap, warnings),
      published: p.published,
      fields: { tags: p.tags, ...(p.description ? { description: p.description } : {}) },
    };
    const match = current.find(c => c.slug === p.slug);
    const { post } = match ? await api(`/api/posts/${match.id}`, { method: "PUT", body: payload }) : await api("/api/posts", { method: "POST", body: payload });
    if (post.slug !== p.slug) warnings.push(`${p.slug} was saved as ${post.slug} (that address was taken)`);
    console.log(`${match ? "updated" : "added"} ${p.published ? "post " : "draft"} ${post.slug}`);
  }
  if (warnings.length) console.log("\nwarnings:\n- " + warnings.join("\n- "));
  console.log(`\ndone. ${posts.filter(p => p.published).length} published, ${posts.filter(p => !p.published).length} drafts.`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
