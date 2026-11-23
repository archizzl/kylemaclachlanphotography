// Run with `npm test`. The style playground's CSS: only what was changed, aimed at the embed's classes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTROLS, DEFAULT_LOOK, SITE_CONTROLS, cleanLook, cssFrom, scopedCss } from "../public/app/stylekit.js";

test("nothing set means no css at all", () => {
  assert.equal(cssFrom({}), "");
  assert.equal(cssFrom({ font: "", size: "", text: "" }), "");
});

test("each setting becomes plain class rules, which beat the embed's defaults", () => {
  const css = cssFrom({ font: "mono", size: "17px", titleColor: "#ff0000", date: "hidden", tags: "filled", tagColor: "#ffee00", corners: "6px" });
  assert.match(css, /\.kmp-embed \{\n  font-family: ui-monospace[^;]*;\n  font-size: 17px;\n\}/); // the whole embed, tags included
  assert.match(css, /\.kmp-title \{\n  color: #ff0000;\n\}/);
  assert.match(css, /\.kmp-title a \{\n  color: inherit;/);
  assert.match(css, /\.kmp-date \{\n  display: none;\n\}/);
  assert.match(css, /\.kmp-tag, \.kmp-menu button \{[^}]*background: #ffee00;/);
  assert.match(css, /\.kmp-menu button\[aria-pressed="true"\] \{[^}]*font-weight: bold;/);
  assert.match(css, /\.kmp-body img, \.kmp-image img \{\n  border-radius: 6px;\n\}/);
  assert.ok(!css.includes(":where")); // plain selectors, so they win
});

test("the preview-only site settings never reach the css", () => {
  assert.equal(cssFrom({ siteBg: "#000000", siteText: "#ffffff", siteFont: "mono" }), "");
});

test("every preset and every option produces valid-looking css", () => {
  for (const [name, preset] of Object.entries({ default: DEFAULT_LOOK })) {
    const css = cssFrom(preset);
    assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length, name);
    assert.ok(!/undefined|NaN/.test(css), name);
  }
  for (const c of [...CONTROLS, ...SITE_CONTROLS]) {
    const values = c.type === "select" ? Object.keys(c.options) : ["#123456"];
    for (const v of values) assert.ok(!/undefined|NaN/.test(cssFrom({ [c.key]: v })), `${c.key}=${v}`);
  }
});

test("tags default to archizzl-style #tags; pill styles switch that off", () => {
  assert.equal(cssFrom({ tags: "" }), "");
  assert.match(cssFrom({ tags: "filled" }), /\.kmp-tag::before, \.kmp-menu button::before \{\n  content: none;/);
  assert.match(cssFrom({ tagColor: "#ff0000" }), /\.kmp-tag, \.kmp-menu button \{\n  color: #ff0000;\n  opacity: 1;/);
});

test("the one default look is archizzl's style guide", () => {
  const css = cssFrom(DEFAULT_LOOK);
  assert.match(css, /\.kmp-embed \{\n  font-family: Calibri, "Atkinson Hyperlegible", Helvetica, sans-serif;\n  font-size: 20px;/);
  assert.match(css, /\.kmp-title \{[^}]*font-weight: 400;[^}]*font-style: italic;/);
  assert.match(css, /\.kmp-body a \{\n  color: #0000ee;\n  text-decoration: none;/);
  assert.match(css, /\.kmp-body a:hover \{\n  text-decoration: underline;/);
});

test("saved looks only keep known settings with allowed values", () => {
  assert.deepEqual(cleanLook({ font: "comic", size: "999px", text: "#ABCDEF", link: "red", evil: "x", siteBg: "#000000", tags: "" }), { font: "comic", text: "#ABCDEF", siteBg: "#000000" });
  assert.deepEqual(cleanLook(null), {});
  assert.deepEqual(cleanLook(DEFAULT_LOOK), DEFAULT_LOOK);
});

test("a look can be limited to one blog's posts", () => {
  const scope = '.kmp-embed[data-blog="maya"]';
  const css = scopedCss({ font: "mono", tags: "filled", siteBg: "#101010", evil: "}</style><script>" }, scope);
  assert.match(css, /^\.kmp-embed\[data-blog="maya"\] \{\n  font-family: ui-monospace/);
  assert.ok(!css.includes("#101010")); // preview-only site colours never reach KMP's pages
  // Every rule starts with the scope, including both halves of combined selectors.
  for (const line of css.split("\n").filter(l => l.endsWith(" {"))) {
    for (const sel of line.slice(0, -2).split(", ")) assert.ok(sel.startsWith(scope), sel);
  }
  assert.ok(!css.includes("</style>"));
});
