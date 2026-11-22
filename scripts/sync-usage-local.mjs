// Copies Cloudflare's real R2 usage numbers into the LOCAL dev database, so the cost pages can be
// checked against real data. (In production the Worker does this itself, daily.)
//
//   CF_ANALYTICS_TOKEN=<token> node scripts/sync-usage-local.mjs
//
// The token needs "Account Analytics: Read". For a quick local check, wrangler's own login works:
//   CF_ANALYTICS_TOKEN=$(npx wrangler auth token) node scripts/sync-usage-local.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchR2Usage, HISTORY_DAYS } from "../src/r2usage.js";

const token = process.env.CF_ANALYTICS_TOKEN;
if (!token) throw new Error("Set CF_ANALYTICS_TOKEN (see the comment at the top of this file).");
const accountId = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8").match(/"CF_ACCOUNT_ID":\s*"([0-9a-f]+)"/)[1];

const now = Date.now();
const day = t => new Date(t).toISOString().slice(0, 10);
const rows = await fetchR2Usage({ accountId, token, from: day(now - HISTORY_DAYS * 864e5), to: day(now) });

const q = v => `'${String(v).replace(/'/g, "''")}'`;
const at = new Date().toISOString();
const sql = rows
  .map(
    r => `INSERT INTO r2_usage_daily (date, bucket, stored_bytes, class_a, class_b, synced_at) VALUES (${q(r.date)}, ${q(r.bucket)}, ${r.stored_bytes}, ${r.class_a}, ${r.class_b}, ${q(at)})
  ON CONFLICT(date, bucket) DO UPDATE SET stored_bytes = excluded.stored_bytes, class_a = excluded.class_a, class_b = excluded.class_b, synced_at = excluded.synced_at;`
  )
  .concat(
    `INSERT INTO app_state (key, value) VALUES ('r2_sync', ${q(JSON.stringify({ at, ok: true, days: new Set(rows.map(r => r.date)).size, error: null }))})
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;`
  )
  .join("\n");

const dir = mkdtempSync(join(tmpdir(), "blog-cdn-usage-"));
const file = join(dir, "usage.sql");
writeFileSync(file, sql);
try {
  execFileSync("npx", ["wrangler", "d1", "execute", "blog-cdn", "--local", "--file", file], { stdio: ["ignore", "ignore", "inherit"] });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const buckets = [...new Set(rows.map(r => r.bucket || "(account)"))].join(", ");
console.log(`saved ${rows.length} rows (${new Set(rows.map(r => r.date)).size} days; ${buckets}) to the local database.`);
