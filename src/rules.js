// What counts as a valid username, post and upload. Pure functions, so the tests can check them.

import { webUrl, today } from "./util.js";

// Usernames are the first part of public URLs (/<user>/feed.xml), so they can't shadow the
// site's own paths.
const RESERVED = new Set(
  "admin api app login logout dashboard embed embed.js _cdn cdn www static assets public favicon.ico robots.txt index.html style.css settings help about".split(" ")
);

export function usernameProblem(name) {
  const n = String(name || "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/.test(n) || n.length < 2) {
    return "Usernames are 2–30 lowercase letters, numbers or dashes, and can't start or end with a dash.";
  }
  if (RESERVED.has(n)) return "That username is taken by the site itself. Pick another.";
  return null;
}

export function slugify(text) {
  return (
    String(text || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/, "") || "post"
  );
}

// Returns [cleanPost, problem]. problem is a sentence to show the friend, or null.
export function cleanPost(input) {
  const p = input || {};
  const title = String(p.title || "").trim().slice(0, 200);
  if (!title) return [null, "Give the post a title."];
  let slug = slugify(p.slug || title);
  // posts.json and feed.json are taken.
  if (slug === "posts" || slug === "feed") slug += "-post";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(p.date || "")) && !isNaN(Date.parse(p.date)) ? p.date : today();
  const body = String(p.body || "");
  if (body.length > 200000) return [null, "That post is too long (200,000 characters at most)."];
  return [{ title, slug, date, body, published: p.published ? 1 : 0 }, null];
}

// Returns [cleanSettings, problem].
export function cleanSettings(input) {
  const s = input || {};
  const displayName = String(s.display_name || "").trim().slice(0, 100);
  const siteRaw = String(s.site_url || "").trim();
  const site = webUrl(siteRaw);
  if (siteRaw && !site) return [null, "Your site address should start with https://"];
  const patternRaw = String(s.post_url_pattern || "").trim();
  const pattern = webUrl(patternRaw.replace("{slug}", "SLUG"));
  if (patternRaw && (!pattern || !patternRaw.includes("{slug}"))) {
    return [null, "The post address pattern should start with https:// and include {slug}, like https://you.neocities.org/blog/{slug}"];
  }
  return [{ display_name: displayName, site_url: site, post_url_pattern: patternRaw ? patternRaw : "" }, null];
}

// ---- uploads ----

export const MAX_UPLOAD = 25 * 1024 * 1024;

// Extension -> served type. SVG, HTML and scripts are deliberately missing: the CDN only hosts
// things that can't run code.
export const UPLOAD_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  pdf: "application/pdf",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

const IMMUTABLE = "public, max-age=31536000, immutable";
export const cacheControlFor = type => (type.startsWith("text/") ? "public, max-age=300" : IMMUTABLE);

// A URL-safe file name that keeps its extension, e.g. "My Photo (1).JPG" -> "my-photo-1.jpg".
export function safeFileName(name) {
  const raw = String(name || "").split(/[\\/]/).pop();
  const dot = raw.lastIndexOf(".");
  const ext = dot > 0 ? raw.slice(dot + 1).toLowerCase() : "";
  const base = (dot > 0 ? raw.slice(0, dot) : raw)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "file";
  return ext ? `${base}.${ext}` : base;
}

// Returns [{ name, type }, problem].
export function checkUpload(name, size) {
  const clean = safeFileName(name);
  const ext = clean.includes(".") ? clean.split(".").pop() : "";
  const type = UPLOAD_TYPES[ext];
  if (!type) return [null, "That kind of file can't be uploaded. Photos (JPEG, PNG, WebP, GIF, AVIF), PDFs and text files (.md, .txt) are fine."];
  if (!size) return [null, "That file was empty."];
  if (size > MAX_UPLOAD) return [null, "That file is too big (25 MB at most)."];
  return [{ name: clean, type }, null];
}

// Checks the first bytes match the extension, so a page can't be uploaded as "photo.jpg".
export function contentMatches(type, bytes) {
  const b = new Uint8Array(bytes.slice ? bytes.slice(0, 16) : bytes);
  const starts = (...sig) => sig.every((v, i) => b[i] === v);
  const ascii = (at, s) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
  switch (type) {
    case "image/jpeg": return starts(0xff, 0xd8, 0xff);
    case "image/png": return starts(0x89, 0x50, 0x4e, 0x47);
    case "image/gif": return ascii(0, "GIF8");
    case "image/webp": return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "image/avif": return ascii(4, "ftyp");
    case "application/pdf": return ascii(0, "%PDF");
    default: return true; // text
  }
}

export const isImage = type => type.startsWith("image/");

// Alt text describes an image for people who can't see it; the caption shows under it.
export function cleanFileText(input) {
  const oneLine = (v, max) => String(v || "").replace(/\s+/g, " ").trim().slice(0, max);
  return { alt: oneLine(input?.alt, 500), caption: oneLine(input?.caption, 1000) };
}
