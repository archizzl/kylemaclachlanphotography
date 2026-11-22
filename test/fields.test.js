// Run with `npm test`. Each friend's own post fields: setting them up, filling them in, using them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanFieldDefs, cleanPostFields, fieldKey, growChoices, listQuery } from "../src/fields.js";

const DEFS = [
  { key: "emotion", name: "emotion", kind: "tags", choices: ["tender", "restless", "hopeful"] },
  { key: "no", name: "no.", kind: "number", auto: true },
  { key: "written_at", name: "written at", kind: "text" },
];

test("field definitions get safe, stable keys", () => {
  const [defs, problem] = cleanFieldDefs([
    { name: "Emotion", kind: "tags", choices: "tender, restless, Tender, ,hopeful" },
    { name: "No.", kind: "number", auto: 1 },
    { name: "Written at", kind: "text" },
    { name: "date", kind: "text" },
    { name: "emotion", kind: "text" },
  ]);
  assert.equal(problem, null);
  assert.deepEqual(defs.map(d => d.key), ["emotion", "no", "written_at", "date_field", "emotion_2"]);
  assert.deepEqual(defs[0].choices, ["tender", "restless", "hopeful"]);
  assert.equal(defs[1].auto, true);
  assert.equal(fieldKey("Où j'étais!"), "ou_j_etais");

  // Renaming keeps the key; a made-up key is ignored.
  const [renamed] = cleanFieldDefs([{ key: "emotion", name: "Feeling", kind: "tags", choices: ["x"] }, { key: "evil'); drop", name: "Mood", kind: "text" }], defs);
  assert.deepEqual(renamed.map(d => d.key), ["emotion", "mood"]);
  assert.equal(renamed[0].name, "Feeling");
});

test("field definitions are checked", () => {
  assert.ok(cleanFieldDefs("nope")[1]);
  assert.ok(cleanFieldDefs([{ name: "", kind: "text" }])[1]);
  assert.ok(cleanFieldDefs([{ name: "x", kind: "photo" }])[1]);
  assert.ok(cleanFieldDefs([{ name: "x", kind: "tags", choices: [] }])[1]);
  assert.ok(cleanFieldDefs(Array.from({ length: 11 }, (_, i) => ({ name: `f${i}`, kind: "text" })))[1]);
});

test("a post's values only keep what the blog has set up", () => {
  const out = cleanPostFields(DEFS, { emotion: ["TENDER", "furious", "hopeful"], no: "7", written_at: "  the 14\nbus stop ", other: "x" });
  assert.deepEqual(out, { emotion: ["tender", "hopeful"], no: 7, written_at: "the 14 bus stop" });
  assert.deepEqual(cleanPostFields(DEFS, { emotion: [], no: "", written_at: "" }), {});
  assert.deepEqual(cleanPostFields(DEFS, { no: "seven" }), {});
});

test("filters and sorts only use known fields", () => {
  const q = listQuery(DEFS, new URLSearchParams("filter=emotion:tender&filter=nope:x&filter=no:abc&sort=-no"));
  assert.match(q.where, /json_each\(p\.fields_json, '\$\.emotion'\)/);
  assert.deepEqual(q.binds, ["tender"]);
  assert.match(q.order, /json_extract\(p\.fields_json, '\$\.no'\) DESC/);
  assert.equal(listQuery(DEFS, new URLSearchParams("sort=emotion")).order, "p.date DESC, p.id DESC"); // tags can't sort
  assert.equal(listQuery(DEFS, new URLSearchParams("sort=date")).order, "p.date ASC, p.id ASC");
  assert.equal(listQuery(DEFS, new URLSearchParams("sort=x') --")).order, "p.date DESC, p.id DESC");
});

test("open tag fields take any tag and learn new ones", () => {
  const [defs, problem] = cleanFieldDefs([{ name: "tags", kind: "tags", open: true, choices: "" }]);
  assert.equal(problem, null);
  assert.deepEqual(defs[0], { key: "tags", name: "tags", kind: "tags", choices: [], open: true });
  // A closed field still needs choices.
  assert.ok(cleanFieldDefs([{ name: "tags", kind: "tags", choices: "" }])[1]);

  const withNyc = [{ ...defs[0], choices: ["nyc"] }];
  const values = cleanPostFields(withNyc, { tags: ["NYC", "bluegrass", " bluegrass ", "", "x".repeat(60)] });
  assert.deepEqual(values.tags, ["nyc", "bluegrass", "x".repeat(40)]); // known spelling kept, dupes dropped, trimmed
  assert.deepEqual(cleanPostFields(withNyc, { tags: "work, interior-design" }).tags, ["work", "interior-design"]);
  assert.equal(cleanPostFields(withNyc, { tags: Array.from({ length: 30 }, (_, i) => `t${i}`) }).tags.length, 20);

  const grown = growChoices(withNyc, values);
  assert.deepEqual(grown[0].choices, ["nyc", "bluegrass", "x".repeat(40)]);
  assert.equal(growChoices(withNyc, { tags: ["nyc"] }), null); // nothing new
});
