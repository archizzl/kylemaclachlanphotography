// Run with `npm test`. The embed builder's codes: short, and exactly what was picked.

import { test } from "node:test";
import assert from "node:assert/strict";
import { embedCode, sortChoices } from "../public/app/embedkit.js";

const base = { origin: "https://kmp.test", cdnBase: "https://cdn.kmp.test", user: "maya", titles: true, fields: true, builtinStyle: true };

test("a plain list is one short tag", () => {
  assert.equal(embedCode({ ...base, show: "list", count: 10 }), '<script src="https://kmp.test/embed.js" data-user="maya" data-list="10" async></script>');
});

test("list options become attributes, only when set", () => {
  const code = embedCode({ ...base, show: "list", count: 20, sort: "-no", filters: { emotion: "tender", mood: "" }, menu: "emotion", menuLabel: "filter by feeling", group: "emotion", titles: false, builtinStyle: false });
  assert.equal(
    code,
    '<script src="https://kmp.test/embed.js" data-user="maya" data-list="20" data-filter="emotion:tender" data-sort="-no" data-menu="emotion" data-menu-label="filter by feeling" data-group="emotion" data-title="no" data-style="none" async></script>'
  );
  // A label without a menu is left out.
  assert.ok(!embedCode({ ...base, show: "list", menuLabel: "x" }).includes("data-menu-label"));
});

test("one post and one photo come with a no-script fallback", () => {
  const post = embedCode({ ...base, show: "post", post: "my-post", postTitle: 'Rain & "Fog"' });
  assert.match(post, /data-post="my-post"/);
  assert.match(post, /<noscript><a href="https:\/\/cdn\.kmp\.test\/maya\/posts\/my-post\.md">Rain &amp; &quot;Fog&quot;<\/a><\/noscript>$/);
  const photo = embedCode({ ...base, show: "photo", photo: "dog.jpg", photoUrl: "https://cdn.kmp.test/maya/dog.jpg", photoAlt: "a dog", caption: false, titles: false });
  assert.match(photo, /data-image="dog\.jpg" data-caption="no" async/);
  assert.ok(!photo.includes("data-title")); // titles don't apply to photos
  assert.match(photo, /<noscript><img src="https:\/\/cdn\.kmp\.test\/maya\/dog\.jpg" alt="a dog"><\/noscript>$/);
});

test("values can't break out of the attributes", () => {
  const code = embedCode({ ...base, show: "list", filters: { tags: 'x" onload="alert(1)' } });
  assert.ok(!code.includes('" onload="'));
});

test("orders: newest, oldest, then number and text fields both ways", () => {
  const fields = [
    { key: "emotion", name: "emotion", kind: "tags", choices: ["a"] },
    { key: "no", name: "no.", kind: "number" },
    { key: "place", name: "place", kind: "text" },
  ];
  assert.deepEqual(sortChoices(fields).map(([v]) => v), ["", "date", "no", "-no", "place", "-place"]);
});

test("a list can be all posts", () => {
  assert.match(embedCode({ ...base, show: "list", count: "all" }), /data-list="all"/);
});
