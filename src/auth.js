// Passwords, sessions and the wrong-password lockout.
//
// Friends: username + password in the users table (PBKDF2). A session is a random token in a
// cookie; only its SHA-256 is stored, in the sessions table.
// Archie (/admin): the ADMIN_PASSWORD secret. The cookie is HMAC-signed with it, so changing the
// secret signs the admin out everywhere.

import { cookie } from "./util.js";

export const SESSION_COOKIE = "kmp_session";
export const ADMIN_COOKIE = "kmp_admin";
export const SESSION_DAYS = 30;
export const MAX_FAILS = 10; // wrong passwords per IP per 15 minutes
const ITERATIONS = 100000; // the most Workers' PBKDF2 allows
const enc = new TextEncoder();

const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// Constant-time byte comparison (crypto.subtle.timingSafeEqual is Workers-only; this runs in tests too).
function equalBytes(a, b) {
  const x = new Uint8Array(a), y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, ITERATIONS))}`;
}

// Something to check against when the username doesn't exist, so the answer takes as long.
const DUMMY_HASH = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function checkPassword(password, stored) {
  const [scheme, iter, salt, hash] = String(stored || DUMMY_HASH).split("$");
  if (scheme !== "pbkdf2" || !salt || !hash) return false;
  const got = await pbkdf2(String(password), unb64(salt), Number(iter));
  const want = unb64(hash);
  return equalBytes(got, want);
}

export function passwordProblem(password) {
  const p = String(password || "");
  if (p.length < 8) return "Passwords need at least 8 characters.";
  if (p.length > 200) return "That password is too long.";
  return null;
}

// Readable starting passwords for Archie to hand out, like "plum-otter-7342".
const WORDS = ("apple berry cedar delta ember fern grape harbor iris juniper kiwi lemon maple nectar olive pepper " +
  "quartz river sage thistle umber violet willow yarrow zinnia otter heron finch badger lark moss pebble").split(" ");
export function generatePassword() {
  const r = crypto.getRandomValues(new Uint32Array(3));
  return `${WORDS[r[0] % WORDS.length]}-${WORDS[r[1] % WORDS.length]}-${1000 + (r[2] % 9000)}`;
}

async function sha256(text) {
  return b64(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

const secureFlag = request => (new URL(request.url).protocol === "https:" ? "; Secure" : "");

// ---- friend sessions ----

export async function startSession(env, request, userId) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32)));
  const expires = Date.now() + SESSION_DAYS * 864e5;
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()).run();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, expires)
    .run();
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secureFlag(request)}`;
}

// The signed-in, enabled friend for this request, or null.
export async function currentUser(env, request) {
  const token = cookie(request, SESSION_COOKIE);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`
  )
    .bind(await sha256(token), Date.now())
    .first();
}

export async function endSession(env, request) {
  const token = cookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function endAllSessions(env, userId) {
  return env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

// ---- admin ----

async function sign(value, env) {
  const key = await crypto.subtle.importKey("raw", enc.encode(`blog-cdn-v1|${env.ADMIN_PASSWORD}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
}

// Compare digests so the comparison takes the same time whatever the input.
export async function same(a, b) {
  const [x, y] = await Promise.all([a, b].map(v => crypto.subtle.digest("SHA-256", enc.encode(String(v)))));
  return equalBytes(x, y);
}

export async function adminCookie(env, request) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  return `${ADMIN_COOKIE}=${exp}.${await sign(String(exp), env)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secureFlag(request)}`;
}

export const clearAdminCookie = () => `${ADMIN_COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0`;

export async function isAdmin(env, request) {
  if (!env.ADMIN_PASSWORD) return false;
  const [exp, sig] = cookie(request, ADMIN_COOKIE).split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return same(sig, await sign(exp, env));
}

// ---- wrong-password lockout ----

const ipOf = request => request.headers.get("cf-connecting-ip") || "local";

// Returns true when this IP has had too many wrong passwords lately.
export async function lockedOut(env, request) {
  const row = await env.DB.prepare("SELECT count, reset_at FROM login_fails WHERE ip = ?").bind(ipOf(request)).first();
  return Boolean(row && row.reset_at > Date.now() && row.count >= MAX_FAILS);
}

export async function recordFail(env, request) {
  const ip = ipOf(request);
  const t = Date.now();
  const row = await env.DB.prepare("SELECT count, reset_at FROM login_fails WHERE ip = ?").bind(ip).first();
  const live = row && row.reset_at > t;
  await env.DB.prepare("INSERT INTO login_fails (ip, count, reset_at) VALUES (?1, ?2, ?3) ON CONFLICT(ip) DO UPDATE SET count = ?2, reset_at = ?3")
    .bind(ip, live ? row.count + 1 : 1, live ? row.reset_at : t + 15 * 60 * 1000)
    .run();
}

export function clearFails(env, request) {
  return env.DB.prepare("DELETE FROM login_fails WHERE ip = ?").bind(ipOf(request)).run();
}
