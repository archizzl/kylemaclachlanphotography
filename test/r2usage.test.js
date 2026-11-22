// Run with `npm test`. Reading Cloudflare's R2 measurements, and pricing months with them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchR2Usage, opClass } from "../src/r2usage.js";
import { costReport } from "../src/costs.js";

const T = s => Date.parse(s);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test("requests are sorted into R2's billing classes", () => {
  assert.equal(opClass("PutObject"), "a");
  assert.equal(opClass("ListBuckets"), "a");
  assert.equal(opClass("GetObject"), "b");
  assert.equal(opClass("HeadObject"), "b");
  assert.equal(opClass("DeleteObject"), null);
  assert.equal(opClass("DeleteObjects"), null);
  assert.equal(opClass("SomethingNew"), "b");
});

test("usage is fetched in chunks Cloudflare allows, only as far back as it keeps, and merged per day and bucket", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    const { variables } = JSON.parse(init.body);
    calls.push(variables);
    assert.equal(init.headers.authorization, "Bearer tok");
    const data = {
      viewer: {
        accounts: [
          {
            storage: [{ max: { payloadSize: 1000, metadataSize: 24 }, dimensions: { date: variables.from, bucketName: "blog" } }],
            ops: [
              { sum: { requests: 3 }, dimensions: { date: variables.from, bucketName: "blog", actionType: "PutObject" } },
              { sum: { requests: 10 }, dimensions: { date: variables.from, bucketName: "blog", actionType: "GetObject" } },
              { sum: { requests: 5 }, dimensions: { date: variables.from, bucketName: "blog", actionType: "DeleteObject" } },
              { sum: { requests: 2 }, dimensions: { date: variables.from, bucketName: "", actionType: "ListBuckets" } },
            ],
          },
        ],
      },
    };
    return new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json" } });
  };
  const rows = await fetchR2Usage({ accountId: "acct", token: "tok", from: "2026-01-01", to: "2026-11-22", fetchImpl: fakeFetch, now: T("2026-11-22T12:00:00Z") });

  // Cloudflare keeps ~89 days and answers 30 at a time.
  assert.equal(calls[0].from, "2026-08-25");
  assert.ok(calls.every(c => (T(c.to) - T(c.from)) / 864e5 <= 29));
  assert.equal(calls.at(-1).to, "2026-11-22");
  assert.equal(calls.length, 3);

  const day = rows.filter(r => r.date === "2026-08-25");
  assert.deepEqual(day.find(r => r.bucket === "blog"), { date: "2026-08-25", bucket: "blog", stored_bytes: 1024, class_a: 3, class_b: 10 });
  assert.deepEqual(day.find(r => r.bucket === ""), { date: "2026-08-25", bucket: "", stored_bytes: 0, class_a: 2, class_b: 0 });
});

test("errors from Cloudflare come through as readable messages", async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ errors: [{ message: "not authorized" }] }), { status: 200 });
  await assert.rejects(fetchR2Usage({ accountId: "a", token: "t", from: "2026-11-01", to: "2026-11-02", fetchImpl: fakeFetch, now: T("2026-11-22") }), /not authorized/);
});

test("measured months use Cloudflare's numbers, split by recorded share", () => {
  const now = T("2026-11-01");
  const mine = [{ bytes: 1e9, from: T("2026-09-01"), to: null }];
  const theirs = [{ bytes: 3e9, from: T("2026-09-01"), to: null }];
  const measured = { "2026-10": { days: 31, accountGB: 30, accountA: 2_000_000, accountB: 1_000, blogGB: 8, blogA: 1_500_000, blogB: 800 } };
  const r = costReport({
    mine,
    everyone: [...mine, ...theirs],
    myUploads: [T("2026-10-02")],
    allUploads: [T("2026-10-02"), T("2026-10-03"), T("2026-10-04"), T("2026-10-05")],
    measured,
    start: T("2026-10-01"),
    now,
  });
  const oct = r.months.find(m => m.month === "2026-10");
  assert.equal(oct.source, "measured");
  near(oct.gbMonths, 8 * 0.25, "a quarter of the measured blog bucket");
  const myA = 1_500_000 * 0.25; // a quarter of the uploads
  const myB = 800 * 0.25;
  near(oct.fullPrice, 2 * 0.015 + (myA / 1e6) * 4.5 + (myB / 1e6) * 0.36, "full price");
  near(oct.storageCharged, 20 * 0.015 * (2 / 30) + (1_000_000 / 1e6) * 4.5 * (myA / 2_000_000), "share of the overage");
  near(oct.account.charged, 20 * 0.015 + 1 * 4.5, "the account's own R2 charge");

  // A month Cloudflare measured before the blog bucket existed: others measured, ours estimated.
  const r2 = costReport({ mine, everyone: mine, myUploads: [], allUploads: [], measured: { "2026-10": { days: 31, accountGB: 0.1, accountA: 10, accountB: 10, blogGB: null } }, start: T("2026-10-01"), now });
  const o2 = r2.months.find(m => m.month === "2026-10");
  assert.equal(o2.source, "measured");
  near(o2.gbMonths, 1, "estimated from the recorded file");
  near(o2.account.gbMonths, 1.1, "measured other buckets plus our estimate");

  // No measurements: estimated.
  assert.equal(costReport({ mine, everyone: mine, myUploads: [], allUploads: [], start: T("2026-10-01"), now }).months[1].source, "estimated");
});
