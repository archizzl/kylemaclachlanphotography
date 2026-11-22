// Cloudflare's own measurements of R2: stored bytes per bucket per day, and requests by kind.
// These are the numbers R2 bills from, so the cost page can use them instead of estimates.
//
// They come from Cloudflare's GraphQL Analytics API, which only keeps about 13 weeks and answers
// at most ~32 days per query. So a daily cron copies them into D1 (r2_usage_daily), where they
// stay. It needs a CF_ANALYTICS_TOKEN secret: an API token with only "Account Analytics: Read".

const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";
export const HISTORY_DAYS = 89; // how far back Cloudflare still has data
const CHUNK_DAYS = 30;

// https://developers.cloudflare.com/r2/pricing/ (checked 2026-11-22). DeleteObjects (bulk delete)
// isn't listed; deletes are free, so it's counted as free too. Anything unknown counts as Class B.
const CLASS_A = new Set(
  "ListBuckets PutBucket ListObjects PutObject CopyObject CompleteMultipartUpload CreateMultipartUpload LifecycleStorageTierTransition ListMultipartUploads UploadPart UploadPartCopy ListParts PutBucketEncryption PutBucketCors PutBucketLifecycleConfiguration".split(" ")
);
const FREE = new Set(["DeleteObject", "DeleteObjects", "DeleteBucket", "AbortMultipartUpload"]);
export const opClass = action => (CLASS_A.has(action) ? "a" : FREE.has(action) ? null : "b");

const day = t => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => day(Date.parse(`${d}T00:00:00Z`) + n * 864e5);

// Rows [{ date, bucket, stored_bytes, class_a, class_b }] for from..to (inclusive dates).
export async function fetchR2Usage({ accountId, token, from, to, fetchImpl = fetch, now = Date.now() }) {
  const oldest = day(now - HISTORY_DAYS * 864e5);
  if (from < oldest) from = oldest;
  const byKey = new Map();
  const row = (date, bucket) => {
    const k = `${date}|${bucket}`;
    if (!byKey.has(k)) byKey.set(k, { date, bucket, stored_bytes: 0, class_a: 0, class_b: 0 });
    return byKey.get(k);
  };

  for (let start = from; start <= to; start = addDays(start, CHUNK_DAYS)) {
    const end = addDays(start, CHUNK_DAYS - 1) < to ? addDays(start, CHUNK_DAYS - 1) : to;
    const query = `query R2Usage($account: string!, $from: Date!, $to: Date!) {
      viewer { accounts(filter: { accountTag: $account }) {
        storage: r2StorageAdaptiveGroups(limit: 10000, filter: { date_geq: $from, date_leq: $to }) {
          max { payloadSize metadataSize } dimensions { date bucketName }
        }
        ops: r2OperationsAdaptiveGroups(limit: 10000, filter: { date_geq: $from, date_leq: $to }) {
          sum { requests } dimensions { date bucketName actionType }
        }
      } }
    }`;
    const res = await fetchImpl(GRAPHQL, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { account: accountId, from: start, to: end } }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.errors?.length || !body.data) {
      const msg = body?.errors?.[0]?.message || `HTTP ${res.status}`;
      throw new Error(`Cloudflare analytics: ${msg}`);
    }
    const acct = body.data.viewer.accounts[0];
    if (!acct) throw new Error("Cloudflare analytics: that account isn't visible to this token.");
    for (const s of acct.storage) {
      // Stored size counts the objects and their metadata.
      row(s.dimensions.date, s.dimensions.bucketName).stored_bytes = (s.max.payloadSize || 0) + (s.max.metadataSize || 0);
    }
    for (const o of acct.ops) {
      const c = opClass(o.dimensions.actionType);
      if (c) row(o.dimensions.date, o.dimensions.bucketName)[`class_${c}`] += o.sum.requests || 0;
    }
  }
  return [...byKey.values()].sort((a, b) => (a.date + a.bucket).localeCompare(b.date + b.bucket));
}

export async function saveR2Usage(db, rows, syncedAt = new Date().toISOString()) {
  const stmt = db.prepare(
    `INSERT INTO r2_usage_daily (date, bucket, stored_bytes, class_a, class_b, synced_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(date, bucket) DO UPDATE SET stored_bytes = excluded.stored_bytes, class_a = excluded.class_a,
       class_b = excluded.class_b, synced_at = excluded.synced_at`
  );
  for (let i = 0; i < rows.length; i += 50) {
    await db.batch(rows.slice(i, i + 50).map(r => stmt.bind(r.date, r.bucket, r.stored_bytes, r.class_a, r.class_b, syncedAt)));
  }
}

// Fetches what's new (the first time: everything Cloudflare still has) and records how it went.
export async function syncR2Usage(env, { now = Date.now(), fetchImpl = fetch } = {}) {
  const status = { at: new Date(now).toISOString(), ok: false, days: 0, error: null };
  try {
    if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) throw new Error("CF_ANALYTICS_TOKEN or CF_ACCOUNT_ID isn't set, so costs are estimated.");
    const last = await env.DB.prepare("SELECT MAX(date) AS d FROM r2_usage_daily").first();
    // Re-read the last few days: today is still filling in, and analytics can arrive late.
    const from = last?.d ? addDays(last.d, -3) : day(now - HISTORY_DAYS * 864e5);
    const rows = await fetchR2Usage({ accountId: env.CF_ACCOUNT_ID, token: env.CF_ANALYTICS_TOKEN, from, to: day(now), fetchImpl, now });
    await saveR2Usage(env.DB, rows, status.at);
    Object.assign(status, { ok: true, days: new Set(rows.map(r => r.date)).size, from });
  } catch (err) {
    status.error = String(err.message || err);
  }
  await env.DB.prepare("INSERT INTO app_state (key, value) VALUES ('r2_sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(status))
    .run();
  return status;
}

export async function syncStatus(db) {
  const row = await db.prepare("SELECT value FROM app_state WHERE key = 'r2_sync'").first();
  const latest = await db.prepare("SELECT MAX(date) AS d, MIN(date) AS first FROM r2_usage_daily").first();
  return { last: row ? JSON.parse(row.value) : null, through: latest?.d || null, since: latest?.first || null };
}

// Per month: { days, accountGB, blogGB (null if the blog bucket isn't in the data), accountA/B, blogA/B }.
// GB-months = the daily stored amounts averaged over the whole month (so this month is "so far").
export async function measuredByMonth(db, blogBucket) {
  const { results } = await db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, COUNT(DISTINCT date) AS days,
         SUM(stored_bytes) AS account_bytedays, SUM(class_a) AS account_a, SUM(class_b) AS account_b,
         SUM(CASE WHEN bucket = ?1 THEN stored_bytes ELSE 0 END) AS blog_bytedays,
         SUM(CASE WHEN bucket = ?1 THEN class_a ELSE 0 END) AS blog_a,
         SUM(CASE WHEN bucket = ?1 THEN class_b ELSE 0 END) AS blog_b,
         SUM(CASE WHEN bucket = ?1 THEN 1 ELSE 0 END) AS blog_rows
       FROM r2_usage_daily GROUP BY month`
    )
    .bind(blogBucket || "")
    .all();
  const out = {};
  for (const r of results) {
    const [y, m] = r.month.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out[r.month] = {
      days: r.days,
      accountGB: r.account_bytedays / daysInMonth / 1e9,
      accountA: r.account_a,
      accountB: r.account_b,
      blogGB: r.blog_rows ? r.blog_bytedays / daysInMonth / 1e9 : null,
      blogA: r.blog_rows ? r.blog_a : null,
      blogB: r.blog_rows ? r.blog_b : null,
    };
  }
  return out;
}
