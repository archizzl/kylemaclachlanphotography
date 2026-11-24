// Run with `npm test`. Test sites: which folder a hostname serves, and redirects without the folder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { siteFor, unprefix } from "../sites/worker.js";

test("the first part of the hostname picks the site", () => {
  assert.equal(siteFor("bruteforce.kylemaclachlanphotography.org"), "bruteforce");
  assert.equal(siteFor("BRBTIME.kylemaclachlanphotography.org"), "brbtime");
  assert.equal(siteFor("brbtime.localhost"), "brbtime");
  assert.equal(siteFor("kylemaclachlanphotography.org"), null);
  assert.equal(siteFor("www.kylemaclachlanphotography.org"), null);
  assert.equal(siteFor("a.b.kylemaclachlanphotography.org"), null);
  assert.equal(siteFor("bruteforce.example.com"), null);
});

test("redirects lose the site folder", () => {
  assert.equal(unprefix("/bruteforce/about/", "bruteforce"), "/about/");
  assert.equal(unprefix("/bruteforce", "bruteforce"), "/");
  assert.equal(unprefix("/bruteforce/x?a=1", "bruteforce"), "/x?a=1");
  assert.equal(unprefix("/bruteforcefan/", "bruteforce"), "/bruteforcefan/");
});
