// What each blog costs, month by month: storage at Cloudflare R2's prices, minus each month's free
// allowance (shared across the whole Cloudflare account), plus a domain if one is paid for
// through Reaction Future Institute.
//
// Storage is added up from when each file (or post) was stored to when it was deleted, the same
// way R2 bills: GB-months, i.e. the average amount stored over the month.

// Cloudflare R2 Standard storage, checked 2026-11-22 at https://developers.cloudflare.com/r2/pricing/
export const RATES = {
  storagePerGBMonth: 0.015, // dollars
  uploadsPerMillion: 4.5, // "Class A" operations (writes, lists): each upload is one
  readsPerMillion: 0.36, // "Class B" operations (reads that reach the bucket, not the CDN cache)
  freeGBMonths: 10, // free each month, across the whole account
  freeUploads: 1_000_000,
  freeReads: 10_000_000,
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
 * mine:        this blog's stored things in R2   [{ bytes, from, to }]
 * everyone:    every blog's stored things in R2  (to split the blog bucket between friends)
 * myUploads / allUploads: upload times (ms)
 * measured:    Cloudflare's own numbers by month, from r2usage.js (may be empty)
 * otherGB:     estimate of the account's other buckets, used only for months with no measurements
 * start:       when the blog began (ms)
 *
 * For each month, Cloudflare's measurements win when there are any:
 *   - the account's real total storage and requests decide how much is over the free allowance;
 *   - the blog bucket's real total is split between friends by the sizes recorded here
 *     (Cloudflare measures buckets, not people), uploads by who uploaded, reads by share of storage.
 * Months without measurements fall back to estimates from the recorded sizes.
 *
 * Returns months newest first, plus all-time totals. Dollar amounts are unrounded.
 */
export function costReport({ mine, everyone, myUploads, allUploads, domain, measured = {}, otherGB = 0, start, now, rates = RATES }) {
  const charges = domainCharges(domain?.since, domain?.cents, now);
  const price = (gb, a, b) => gb * rates.storagePerGBMonth + (a / 1e6) * rates.uploadsPerMillion + (b / 1e6) * rates.readsPerMillion;

  const months = monthsSince(start, now).map(key => {
    const [ms, me] = monthRange(key);
    const elapsed = Math.min(1, Math.max(0, (now - ms) / (me - ms))); // the current month is partway through
    const estMyGB = gbMonths(mine, key, now);
    const estBlogGB = gbMonths(everyone, key, now);
    const uploads = myUploads.filter(t => monthKey(t) === key).length;
    const blogUploads = allUploads.filter(t => monthKey(t) === key).length;
    const storageShare = estBlogGB > 0 ? estMyGB / estBlogGB : 0;
    const m = measured[key];

    let myGB, myA, myB, accountGB, accountA, accountB, source;
    if (m && m.days > 0) {
      source = "measured";
      if (m.blogGB != null) {
        // The blog bucket as Cloudflare measured it, split by who stores what.
        myGB = m.blogGB * storageShare;
        myA = m.blogA * (blogUploads > 0 ? uploads / blogUploads : storageShare);
        myB = m.blogB * storageShare;
        accountGB = m.accountGB;
        accountA = m.accountA;
        accountB = m.accountB;
      } else {
        // The blog bucket wasn't in that month's measurements yet: other buckets measured, ours estimated.
        myGB = estMyGB;
        myA = uploads;
        myB = 0;
        accountGB = m.accountGB + estBlogGB;
        accountA = m.accountA + blogUploads;
        accountB = m.accountB;
      }
    } else {
      source = "estimated";
      myGB = estMyGB;
      myA = uploads;
      myB = 0;
      accountGB = estBlogGB + otherGB * elapsed;
      accountA = blogUploads;
      accountB = 0;
    }

    // Cloudflare only charges past each month's free allowance (shared by the whole account);
    // this blog pays its share of whatever is over.
    const overGB = Math.max(0, accountGB - rates.freeGBMonths);
    const overA = Math.max(0, accountA - rates.freeUploads);
    const overB = Math.max(0, accountB - rates.freeReads);
    const share = (mineX, allX) => (allX > 0 ? mineX / allX : 0);
    const storageCharged =
      overGB * rates.storagePerGBMonth * share(myGB, accountGB) +
      (overA / 1e6) * rates.uploadsPerMillion * share(myA, accountA) +
      (overB / 1e6) * rates.readsPerMillion * share(myB, accountB);
    const domainDollars = charges.filter(c => c.month === key).reduce((s, c) => s + c.dollars, 0);

    return {
      month: key,
      partial: elapsed < 1,
      source,
      gbMonths: myGB,
      uploads,
      fullPrice: price(myGB, myA, myB),
      storageCharged,
      domain: domainDollars,
      total: storageCharged + domainDollars,
      // The whole Cloudflare account's R2 for this month, for /admin.
      account: {
        gbMonths: accountGB,
        classA: accountA,
        classB: accountB,
        fullPrice: price(accountGB, accountA, accountB),
        charged: overGB * rates.storagePerGBMonth + (overA / 1e6) * rates.uploadsPerMillion + (overB / 1e6) * rates.readsPerMillion,
      },
    };
  });
  const sum = k => months.reduce((s, m) => s + m[k], 0);
  return {
    months: months.reverse(),
    allTime: { fullPrice: sum("fullPrice"), storageCharged: sum("storageCharged"), domain: sum("domain"), total: sum("total"), uploads: sum("uploads") },
  };
}

// Everything the Worker needs to read for a report, shaped for costReport.
// Only what's stored in R2 is priced: files, and the .md copy of each published post. Posts' rows
// in the database are covered by Cloudflare's included database storage.
export async function loadCostData(env) {
  const toMs = s => (s ? Date.parse(s) : null);
  const { results: files } = await env.DB.prepare("SELECT user_id, size, created_at, deleted_at FROM files").all();
  const { results: posts } = await env.DB.prepare(
    `SELECT user_id, created_at, length(CAST(title AS BLOB)) + length(CAST(body_md AS BLOB)) + 20 AS md_bytes
     FROM posts WHERE published = 1`
  ).all();
  const items = [];
  for (const f of files) items.push({ user: f.user_id, kind: "files", bytes: f.size, from: toMs(f.created_at), to: toMs(f.deleted_at) });
  for (const p of posts) items.push({ user: p.user_id, kind: "text", bytes: p.md_bytes, from: toMs(p.created_at), to: null });
  const uploads = files.map(f => ({ user: f.user_id, at: toMs(f.created_at) }));
  return { items, uploads };
}

export function reportFor(user, data, { otherGB, measured, now }) {
  const mine = data.items.filter(i => i.user === user.id);
  return costReport({
    mine,
    everyone: data.items,
    myUploads: data.uploads.filter(u => u.user === user.id).map(u => u.at),
    allUploads: data.uploads.map(u => u.at),
    domain: { since: user.domain_since, cents: user.domain_cost_cents },
    measured,
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
