// What each blog costs, month by month: storage at Cloudflare R2's prices, minus each month's free
// allowance (shared across the whole Cloudflare account), plus a domain if one is paid for
// through RFR.
//
// Storage is added up from when each file (or post) was stored to when it was deleted, the same
// way R2 bills: GB-months, i.e. the average amount stored over the month.

// Cloudflare R2 Standard storage, checked 2026-11-22 at https://developers.cloudflare.com/r2/pricing/
export const RATES = {
  storagePerGBMonth: 0.015, // dollars
  uploadsPerMillion: 4.5, // "Class A" operations: each upload is one
  freeGBMonths: 10, // free each month, across the whole account
  freeUploads: 1_000_000,
  source: "https://developers.cloudflare.com/r2/pricing/",
  checked: "2026-11-22",
};

const GB = 1e9;
const monthKey = t => new Date(t).toISOString().slice(0, 7);

function monthRange(key) {
  const [y, m] = key.split("-").map(Number);
  return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1)];
}

// "2026-09" … the month of `now`, oldest first.
export function monthsSince(start, now) {
  const out = [];
  let [y, m] = monthKey(Math.min(start, now)).split("-").map(Number);
  const last = monthKey(now);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key === last || out.length > 600) break;
    m === 12 ? ((y += 1), (m = 1)) : (m += 1);
  }
  return out;
}

// GB-months stored during one month. items: [{ bytes, from: ms, to: ms | null }].
export function gbMonths(items, key, now) {
  const [start, end] = monthRange(key);
  let byteMs = 0;
  for (const it of items) {
    const a = Math.max(it.from, start);
    const b = Math.min(it.to ?? now, end, now);
    if (b > a) byteMs += it.bytes * (b - a);
  }
  return byteMs / (end - start) / GB;
}

// Dates a yearly domain was paid for: the first day, then every anniversary up to now.
export function domainCharges(since, cents, now) {
  if (!since || !cents) return [];
  const [y, m, d] = since.split("-").map(Number);
  const out = [];
  for (let i = 0; i < 100; i++) {
    const t = Date.UTC(y + i, m - 1, d);
    if (t > now) break;
    out.push({ month: monthKey(t), dollars: cents / 100 });
  }
  return out;
}

export function nextRenewal(since, now) {
  if (!since) return null;
  const [y, m, d] = since.split("-").map(Number);
  for (let i = 0; i < 200; i++) {
    const t = Date.UTC(y + i, m - 1, d);
    if (t > now) return new Date(t).toISOString().slice(0, 10);
  }
  return null;
}

/*
 * mine:        this blog's stored things   [{ bytes, from, to }]
 * everyone:    every blog's stored things  (to share out the free allowance)
 * myUploads / allUploads: upload times (ms)
 * otherGB:     what the account's other buckets hold (not tracked here; set in wrangler.jsonc)
 * start:       when the blog began (ms)
 *
 * Returns months newest first, plus all-time totals. Dollar amounts are unrounded.
 */
export function costReport({ mine, everyone, myUploads, allUploads, domain, otherGB = 0, start, now, rates = RATES }) {
  const charges = domainCharges(domain?.since, domain?.cents, now);
  const months = monthsSince(start, now).map(key => {
    const [ms, me] = monthRange(key);
    const elapsed = Math.min(1, Math.max(0, (now - ms) / (me - ms))); // the current month is partway through
    const myGB = gbMonths(mine, key, now);
    const accountGB = gbMonths(everyone, key, now) + otherGB * elapsed;
    const uploads = myUploads.filter(t => monthKey(t) === key).length;
    const accountUploads = allUploads.filter(t => monthKey(t) === key).length;

    const fullStorage = myGB * rates.storagePerGBMonth;
    const fullUploads = (uploads / 1e6) * rates.uploadsPerMillion;
    // Cloudflare only charges past the free allowance; this blog pays its share of anything over.
    const overGB = Math.max(0, accountGB - rates.freeGBMonths);
    const overUploads = Math.max(0, accountUploads - rates.freeUploads);
    const chargedStorage = accountGB > 0 ? overGB * rates.storagePerGBMonth * (myGB / accountGB) : 0;
    const chargedUploads = accountUploads > 0 ? (overUploads / 1e6) * rates.uploadsPerMillion * (uploads / accountUploads) : 0;
    const domainDollars = charges.filter(c => c.month === key).reduce((s, c) => s + c.dollars, 0);

    return {
      month: key,
      partial: elapsed < 1,
      gbMonths: myGB,
      uploads,
      fullPrice: fullStorage + fullUploads,
      storageCharged: chargedStorage + chargedUploads,
      domain: domainDollars,
      total: chargedStorage + chargedUploads + domainDollars,
      accountGB,
    };
  });
  const sum = k => months.reduce((s, m) => s + m[k], 0);
  return {
    months: months.reverse(),
    allTime: { fullPrice: sum("fullPrice"), storageCharged: sum("storageCharged"), domain: sum("domain"), total: sum("total"), uploads: sum("uploads") },
  };
}

// Everything the Worker needs to read for a report, shaped for costReport.
// Posts count as text: their row in the database, plus the .md copy of published ones.
export async function loadCostData(env) {
  const toMs = s => (s ? Date.parse(s) : null);
  const { results: files } = await env.DB.prepare("SELECT user_id, size, created_at, deleted_at FROM files").all();
  const { results: posts } = await env.DB.prepare(
    `SELECT user_id, created_at, published,
       length(CAST(title AS BLOB)) + length(CAST(body_md AS BLOB)) + length(CAST(body_html AS BLOB)) + length(CAST(fields_json AS BLOB)) AS db_bytes,
       length(CAST(title AS BLOB)) + length(CAST(body_md AS BLOB)) + 20 AS md_bytes
     FROM posts`
  ).all();
  const items = [];
  for (const f of files) items.push({ user: f.user_id, kind: "files", bytes: f.size, from: toMs(f.created_at), to: toMs(f.deleted_at) });
  for (const p of posts) items.push({ user: p.user_id, kind: "text", bytes: p.db_bytes + (p.published ? p.md_bytes : 0), from: toMs(p.created_at), to: null });
  const uploads = files.map(f => ({ user: f.user_id, at: toMs(f.created_at) }));
  return { items, uploads };
}

export function reportFor(user, data, { otherGB, now }) {
  const mine = data.items.filter(i => i.user === user.id);
  return costReport({
    mine,
    everyone: data.items,
    myUploads: data.uploads.filter(u => u.user === user.id).map(u => u.at),
    allUploads: data.uploads.map(u => u.at),
    domain: { since: user.domain_since, cents: user.domain_cost_cents },
    otherGB,
    // From whichever came first: the account, its first file or post, or its domain.
    start: Math.min(Date.parse(user.created_at) || now, ...mine.map(i => i.from), Date.parse(user.domain_since) || now),
    now,
  });
}

// What's stored right now, split into files and text.
export function storedNow(data, userId) {
  const live = data.items.filter(i => i.user === userId && i.to == null);
  const sum = kind => live.filter(i => i.kind === kind).reduce((s, i) => s + i.bytes, 0);
  return { files: sum("files"), text: sum("text") };
}
