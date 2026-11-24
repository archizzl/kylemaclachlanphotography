/*
 * Sign-ups: anyone can ask for a blog at /signup with their first name, a blog name, a password and
 * their favorite photo of Kyle MacLachlan. Archie accepts or denies each request at /admin.
 * Accepting makes the account (with the password they chose), and adds their photo to the
 * rotation above the front page's title (kyle_photos, which Archie can also add to and remove from
 * at /admin). Denying deletes the photo.
 *
 * The password is hashed as soon as it arrives, and the hash is emptied once the request is
 * decided. While a request waits, its photo sits in the bucket under a random name
 * (_kyle/<uuid>.<ext>), which nobody can guess. Usernames can't start with "_", so it can't
 * collide with a blog's files.
 */

import { hashPassword, passwordProblem } from "./auth.js";
import { contentMatches, usernameProblem } from "./rules.js";
import { now } from "./util.js";

export const MAX_PHOTO = 10 * 1024 * 1024;
const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
// Spam limits: a few requests per IP a day, and a ceiling on how many can wait at once.
export const PER_IP_PER_DAY = 3;
export const MAX_PENDING = 100;

const oneLine = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// A username from the blog name ("BRUTE FORCE" -> "bruteforce"), or the first name if the blog
// name has no letters or numbers. Up to 30 characters.
export function baseUsername(blogName, firstName) {
  const squash = s =>
    String(s || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "")
      .replace(/-{2,}/g, "-")
      .replace(/^-+/, "")
      .slice(0, 30)
      .replace(/-+$/, "");
  return squash(blogName) || squash(firstName) || "blog";
}

const taken = async (env, name, exceptSignup = 0) =>
  Boolean(
    (await env.DB.prepare("SELECT 1 FROM users WHERE username = ?").bind(name).first()) ||
      (await env.DB.prepare("SELECT 1 FROM signups WHERE username = ? AND status = 'pending' AND id != ?").bind(name, exceptSignup).first())
  );

// The first free username: the base, then base-2, base-3…
async function freeUsername(env, base) {
  for (let n = 1; n < 1000; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const name = base.slice(0, 30 - suffix.length).replace(/-+$/, "") + suffix;
    if (!usernameProblem(name) && !(await taken(env, name))) return name;
  }
  return null;
}

// Checks and stores a request. Returns { ok, username, firstName } or { error, status }.
export async function submitSignup(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return { error: "Something went wrong sending that. Try again.", status: 400 };
  }
  // A field people never see; bots fill it in.
  if (String(form.get("website") || "")) return { ok: true, username: "", firstName: "" };

  const firstName = oneLine(form.get("first_name"), 60);
  const blogName = oneLine(form.get("blog_name"), 200);
  const password = String(form.get("password") || "");
  const photo = form.get("photo");
  if (!firstName) return { error: "What's your first name?", status: 400 };
  if (!blogName) return { error: "What would you like your blog to be called?", status: 400 };
  const pw = passwordProblem(password);
  if (pw) return { error: pw, status: 400 };
  if (!photo || typeof photo === "string" || !photo.size) return { error: "Add your favorite photo of Kyle MacLachlan.", status: 400 };
  if (photo.size > MAX_PHOTO) return { error: "That photo is too big (10 MB at most).", status: 400 };
  const ext = PHOTO_TYPES[String(photo.type).toLowerCase()];
  const bytes = await photo.arrayBuffer();
  if (!ext || !contentMatches(photo.type.toLowerCase(), bytes)) {
    return { error: "That doesn't look like a photo. Use a JPEG, PNG, WebP, GIF or AVIF.", status: 400 };
  }

  const ip = request.headers.get("cf-connecting-ip") || "local";
  const since = new Date(Date.now() - 864e5).toISOString();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM signups WHERE ip = ? AND created_at > ?").bind(ip, since).first();
  if (recent.n >= PER_IP_PER_DAY) return { error: "There have been a few sign-ups from here today already. Try again tomorrow, or text Archie.", status: 429 };
  const waiting = await env.DB.prepare("SELECT COUNT(*) AS n FROM signups WHERE status = 'pending'").first();
  if (waiting.n >= MAX_PENDING) return { error: "Sign-ups are paused for now. Try again in a few days, or text Archie.", status: 503 };

  const username = await freeUsername(env, baseUsername(blogName, firstName));
  if (!username) return { error: "Try a different blog name.", status: 400 };

  const key = `_kyle/${crypto.randomUUID()}.${ext}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: photo.type.toLowerCase(), cacheControl: "public, max-age=31536000, immutable" } });
  const dim = v => {
    const n = Number(v);
    return n > 0 && n < 100000 ? Math.round(n) : null;
  };
  await env.DB.prepare(
    `INSERT INTO signups (first_name, blog_name, username, password_hash, photo_key, photo_type, photo_size, photo_width, photo_height, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(firstName, blogName, username, await hashPassword(password), key, photo.type.toLowerCase(), bytes.byteLength, dim(form.get("width")), dim(form.get("height")), ip, now())
    .run();
  return { ok: true, username, firstName };
}

export function pendingSignups(env) {
  return env.DB.prepare("SELECT id, first_name, blog_name, username, photo_key, created_at FROM signups WHERE status = 'pending' ORDER BY created_at").all().then(r => r.results);
}

// Accepts a request: makes the account. `username` lets Archie change it first.
// Returns { text, problem? } for the admin page.
export async function acceptSignup(env, id, username) {
  const s = await env.DB.prepare("SELECT * FROM signups WHERE id = ? AND status = 'pending'").bind(id).first();
  if (!s) return { text: "That request was already decided.", problem: true };
  const name = String(username || s.username).trim().toLowerCase();
  const problem =
    usernameProblem(name) ||
    ((await env.DB.prepare("SELECT 1 FROM users WHERE username = ?").bind(name).first()) ? `There's already a blog called ${name}. Pick another username.` : null) ||
    ((await env.DB.prepare("SELECT 1 FROM signups WHERE username = ? AND status = 'pending' AND id != ?").bind(name, id).first()) ? `Another request is waiting with the username ${name}. Pick another.` : null);
  if (problem) return { text: problem, problem: true };
  const t = now();
  const user = await env.DB.prepare("INSERT INTO users (username, display_name, first_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .bind(name, s.blog_name, s.first_name, s.password_hash, t)
    .first();
  await env.DB.prepare("UPDATE signups SET status = 'accepted', username = ?, user_id = ?, password_hash = '', decided_at = ? WHERE id = ?").bind(name, user.id, t, id).run();
  await env.DB.prepare("INSERT OR IGNORE INTO kyle_photos (key, width, height, credit, signup_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(s.photo_key, s.photo_width, s.photo_height, s.first_name, id, t)
    .run();
  return { text: `accepted ${s.first_name} as ${name}.` };
}

// Denies a request and deletes its photo.
export async function denySignup(env, id) {
  const s = await env.DB.prepare("SELECT * FROM signups WHERE id = ? AND status = 'pending'").bind(id).first();
  if (!s) return { text: "That request was already decided.", problem: true };
  await env.FILES.delete(s.photo_key);
  await env.DB.prepare("UPDATE signups SET status = 'denied', password_hash = '', decided_at = ? WHERE id = ?").bind(now(), id).run();
  return { text: `denied ${s.first_name}.` };
}

// The photos the front page cycles through, oldest first.
export async function kylePhotos(env) {
  const { results } = await env.DB.prepare("SELECT id, key, width, height, credit, created_at FROM kyle_photos ORDER BY created_at, id").all();
  return results;
}

// Archie adds a photo at /admin. Returns { text, problem? } for the admin page.
export async function addKylePhoto(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return { text: "Something went wrong sending that. Try again.", problem: true };
  }
  const photo = form.get("photo");
  if (!photo || typeof photo === "string" || !photo.size) return { text: "Choose a photo.", problem: true };
  if (photo.size > MAX_PHOTO) return { text: "That photo is too big (10 MB at most).", problem: true };
  const type = String(photo.type).toLowerCase();
  const bytes = await photo.arrayBuffer();
  if (!PHOTO_TYPES[type] || !contentMatches(type, bytes)) return { text: "That doesn't look like a photo. Use a JPEG, PNG, WebP, GIF or AVIF.", problem: true };
  const key = `_kyle/${crypto.randomUUID()}.${PHOTO_TYPES[type]}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
  const dim = v => {
    const n = Number(v);
    return n > 0 && n < 100000 ? Math.round(n) : null;
  };
  await env.DB.prepare("INSERT INTO kyle_photos (key, width, height, credit, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(key, dim(form.get("width")), dim(form.get("height")), oneLine(form.get("credit"), 60), now())
    .run();
  return { text: "added." };
}

// Takes a photo out of the rotation and deletes the file.
export async function removeKylePhoto(env, id) {
  const p = await env.DB.prepare("SELECT key FROM kyle_photos WHERE id = ?").bind(id).first();
  if (!p) return { text: "That photo was already removed.", problem: true };
  await env.FILES.delete(p.key);
  await env.DB.prepare("DELETE FROM kyle_photos WHERE id = ?").bind(id).run();
  return { text: "removed." };
}

// For the login page: a request still waiting under this username and password.
export async function waitingFor(env, username) {
  return env.DB.prepare("SELECT password_hash FROM signups WHERE username = ? AND status = 'pending'").bind(username).first();
}
