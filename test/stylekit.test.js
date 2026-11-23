// Run with `npm test`. The style playground's CSS: only what was changed, aimed at the embed's classes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTROLS, PRESETS, SITE_CONTROLS, cssFrom } from "../public/app/stylekit.js";

test("nothing set means no css at all", () => {
  assert.equal(cssFrom({}), "");
  assert.equal(cssFrom({ font: "", size: "", text: "" }), "");
});

test("each setting becomes plain class rules, which beat the embed's defaults", () => {
  const css = cssFrom({ font: "mono", size: "17px", titleColor: "#ff0000", date: "hidden", tags: "filled", tagColor: "#ffee00", corners: "6px" });
  assert.match(css, /\.kmp-post \{\n  font-family: ui-monospace[^;]*;\n  font-size: 17px;\n\}/);
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
  for (const [name, preset] of Object.entries(PRESETS)) {
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
