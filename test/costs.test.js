// Run with `npm test`. The arithmetic behind each blog's cost page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { appBilling, costReport, domainCharges, gbMonths, monthsSince, nextRenewal } from "../src/costs.js";
import { cleanDomain } from "../src/rules.js";

const T = s => Date.parse(s);
const GB = 1e9;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test("months run from the start to now", () => {
  assert.deepEqual(monthsSince(T("2025-11-20"), T("2026-02-03")), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(monthsSince(T("2026-02-01"), T("2026-02-03")), ["2026-02"]);
});

test("storage is averaged over the month, like R2 bills it", () => {
  const now = T("2026-12-15");
  near(gbMonths([{ bytes: GB, from: T("2026-09-01"), to: null }], "2026-10", now), 1, "a whole month");
  near(gbMonths([{ bytes: GB, from: T("2026-10-17T00:00:00Z"), to: null }], "2026-10", now), 15 / 31, "from the 17th");
  near(gbMonths([{ bytes: GB, from: T("2026-10-01"), to: T("2026-10-11T00:00:00Z") }], "2026-10", now), 10 / 31, "deleted on the 11th");
  near(gbMonths([{ bytes: GB, from: T("2026-12-01"), to: null }], "2026-12", now), 14 / 31, "this month, so far");
  assert.equal(gbMonths([{ bytes: GB, from: T("2026-11-05"), to: null }], "2026-10", now), 0);
});

test("the free allowance is shared; only the overage is charged, split by share", () => {
  const now = T("2026-11-01"); // October is complete
  const mine = [{ bytes: 5 * GB, from: T("2026-09-01"), to: null }];
  const theirs = [{ bytes: 15 * GB, from: T("2026-09-01"), to: null }];
  const r = costReport({ mine, everyone: [...mine, ...theirs], myUploads: [], allUploads: [], start: T("2026-10-01"), now });
  const oct = r.months.find(m => m.month === "2026-10");
  near(oct.fullPrice, 5 * 0.015, "full price");
  near(oct.storageCharged, (20 - 10) * 0.015 * (5 / 20), "my share of the overage");

  // Under the allowance, nothing is charged.
  const small = costReport({ mine, everyone: mine, myUploads: [T("2026-10-03")], allUploads: [T("2026-10-03")], start: T("2026-10-01"), now });
  const s = small.months.find(m => m.month === "2026-10");
  assert.equal(s.storageCharged, 0);
  assert.equal(s.uploads, 1);
  near(s.fullPrice, 5 * 0.015 + 4.5 / 1e6, "storage plus one upload");
  assert.equal(small.allTime.total, 0);

  // Other buckets on the account count toward the allowance too.
  const crowded = costReport({ mine, everyone: mine, myUploads: [], allUploads: [], otherGB: 25, start: T("2026-10-01"), now });
  near(crowded.months.find(m => m.month === "2026-10").storageCharged, (30 - 10) * 0.015 * (5 / 30), "with other buckets");
});

test("domains are charged on the day they're first paid for, then yearly", () => {
  const now = T("2026-11-22");
  assert.deepEqual(domainCharges("2025-03-10", 1044, now), [{ month: "2025-03", dollars: 10.44 }, { month: "2026-03", dollars: 10.44 }]);
  assert.equal(nextRenewal("2025-03-10", now), "2027-03-10");
  const r = costReport({ mine: [], everyone: [], myUploads: [], allUploads: [], domain: { since: "2025-03-10", cents: 1044 }, start: T("2025-03-01"), now });
  near(r.allTime.total, 20.88, "two years of domain");
  assert.equal(r.months[0].month, "2026-11"); // newest first
  assert.equal(r.months[0].partial, true);
});

test("domains are checked", () => {
  assert.deepEqual(cleanDomain({ domain: "https://Maya.com/blog", cost: "$10.44", since: "2025-03-10" })[0], { domain: "maya.com", cents: 1044, since: "2025-03-10" });
  assert.deepEqual(cleanDomain({ domain: "" })[0], { domain: "", cents: 0, since: "" });
  assert.ok(cleanDomain({ domain: "not a domain", cost: 1, since: "2025-01-01" })[1]);
  assert.ok(cleanDomain({ domain: "maya.com", cost: "ten", since: "2025-01-01" })[1]);
  assert.ok(cleanDomain({ domain: "maya.com", cost: 10 })[1]);
});

test("whole-app billing adds every blog up, with a running total", () => {
  const now = T("2026-11-22");
  const a = costReport({ mine: [], everyone: [], myUploads: [], allUploads: [], domain: { since: "2025-03-10", cents: 1000 }, start: T("2025-03-01"), now });
  const b = costReport({ mine: [], everyone: [], myUploads: [], allUploads: [], domain: { since: "2026-03-20", cents: 500 }, start: T("2026-01-01"), now });
  const bill = appBilling([a, b]);
  near(bill.allTime.total, 10 + 10 + 5, "two years of one domain plus one of another");
  near(bill.allTime.domains, 25, "domains");
  const mar26 = bill.months.find(m => m.month === "2026-03");
  near(mar26.total, 15, "both renewals in March 2026");
  near(mar26.cumulative, 25, "running total by then");
  near(bill.months.find(m => m.month === "2025-03").cumulative, 10, "running total at the start");
  assert.equal(bill.months[0].month, "2026-11"); // newest first
});
