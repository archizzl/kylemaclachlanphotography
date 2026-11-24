// The style playground's controls, and the CSS they turn into. No page code here, so the tests can
// import it too. Every control left at "" (not set) writes nothing, so the generated CSS only holds
// what the person actually changed, and their own site's styles fill in the rest.

export const FONTS = {
  "": "your site's font",
  archizzl: "Calibri / Atkinson (archizzl)",
  serif: "serif (Georgia)",
  sans: "sans (Helvetica)",
  system: "system (San Francisco, Segoe…)",
  atkinson: "Atkinson Hyperlegible",
  mono: "mono (typewriter)",
  comic: "Comic Sans",
  times: "Times",
};
const FONT_STACKS = {
  archizzl: 'Calibri, "Atkinson Hyperlegible", Helvetica, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  system: "system-ui, -apple-system, \"Segoe UI\", sans-serif",
  atkinson: '"Atkinson Hyperlegible", sans-serif',
  mono: 'ui-monospace, Menlo, Consolas, "Courier New", monospace',
  comic: '"Comic Sans MS", "Comic Neue", cursive',
  times: '"Times New Roman", Times, serif',
};

const opts = (...values) => Object.fromEntries(values.map(v => (Array.isArray(v) ? v : [v, v])));
const NOT_SET = ["", "—"];

// type: select | color | check. Groups are shown in this order.
export const CONTROLS = [
  { group: "writing", key: "font", label: "font", type: "select", options: FONTS },
  { group: "writing", key: "size", label: "text size", type: "select", options: opts(NOT_SET, "14px", "15px", "16px", "17px", "18px", "19px", "20px", "22px", "24px") },
  { group: "writing", key: "leading", label: "line spacing", type: "select", options: opts(NOT_SET, ["1.3", "tight"], ["1.5", "normal"], ["1.7", "roomy"], ["1.9", "airy"]) },
  { group: "writing", key: "text", label: "text colour", type: "color" },
  { group: "writing", key: "width", label: "width", type: "select", options: opts(NOT_SET, ["480px", "narrow"], ["620px", "medium"], ["760px", "wide"]) },
  { group: "writing", key: "align", label: "text", type: "select", options: opts(NOT_SET, ["left", "left-aligned"], ["justify", "justified"], ["center", "centred"]) },

  { group: "titles", key: "titleSize", label: "size", type: "select", options: opts(NOT_SET, ["1.2em", "small"], ["1.5em", "medium"], ["2em", "big"], ["2.6em", "huge"]) },
  { group: "titles", key: "titleWeight", label: "weight", type: "select", options: opts(NOT_SET, ["400", "regular"], ["700", "bold"], ["900", "heavy"]) },
  { group: "titles", key: "titleStyle", label: "style", type: "select", options: opts(NOT_SET, ["italic", "italic"], ["upper", "CAPITALS"], ["lower", "lowercase"]) },
  { group: "titles", key: "titleAlign", label: "position", type: "select", options: opts(NOT_SET, ["left", "left"], ["center", "centred"]) },
  { group: "titles", key: "titleColor", label: "colour", type: "color" },
  { group: "titles", key: "titleFont", label: "font", type: "select", options: { "": "same as writing", ...Object.fromEntries(Object.entries(FONTS).slice(1)) } },

  { group: "dates", key: "date", label: "dates", type: "select", options: opts(NOT_SET, ["faded", "small and faded"], ["italic", "italic"], ["badge", "in a little badge"], ["hidden", "hidden"]) },

  { group: "links", key: "link", label: "colour", type: "color" },
  { group: "links", key: "underline", label: "underline", type: "select", options: opts(NOT_SET, ["always", "always"], ["hover", "only on hover"], ["never", "never"]) },

  { group: "tags", key: "tags", label: "tags look", type: "select", options: opts(["", "#tags (the default)"], ["outline", "outlined pills"], ["filled", "filled pills"], ["square", "square labels"]) },
  { group: "tags", key: "tagColor", label: "colour", type: "color" },

  { group: "photos", key: "corners", label: "corners", type: "select", options: opts(NOT_SET, ["0", "square"], ["6px", "a little round"], ["18px", "very round"]) },
  { group: "photos", key: "frame", label: "frame", type: "select", options: opts(NOT_SET, ["none", "none"], ["thin", "thin line"], ["thick", "thick line"], ["polaroid", "white border (polaroid)"], ["shadow", "soft shadow"]) },
  { group: "photos", key: "photoWidth", label: "width", type: "select", options: opts(NOT_SET, ["100%", "full width"], ["75%", "three quarters, centred"], ["50%", "half, centred"]) },

  { group: "posts", key: "gap", label: "space between posts", type: "select", options: opts(NOT_SET, ["1.5em", "small"], ["3em", "medium"], ["5em", "large"]) },
  { group: "posts", key: "divider", label: "between posts", type: "select", options: opts(NOT_SET, ["line", "a line"], ["dashed", "a dashed line"], ["dots", "three dots"]) },
  { group: "posts", key: "card", label: "card behind each post", type: "color" },
  { group: "posts", key: "cardEdge", label: "card edge", type: "select", options: opts(NOT_SET, ["line", "thin line"], ["round", "rounded"], ["both", "line + rounded"]) },

  { group: "boxes and quotes", key: "accent", label: "[[box]] and quote colour", type: "color" },
  { group: "boxes and quotes", key: "boxFill", label: "[[box]] fill", type: "color" },
];

// The page around the posts: in the style tab's preview, and on the blog's own pages on KMP (its
// page, posts and tag feeds, and its preview site), but never in the copied CSS or the front page.
export const SITE_CONTROLS = [
  { key: "siteBg", label: "background", type: "color", def: "#ffffff" },
  { key: "siteText", label: "text", type: "color", def: "#000000" },
  { key: "siteFont", label: "font", type: "select", options: { archizzl: "Calibri / Atkinson", serif: "serif", sans: "sans", system: "system", mono: "mono", times: "Times", comic: "Comic Sans" }, def: "archizzl" },
];

// The one built-in look: archizzl.com's style guide (archizzl.github.io/STYLE.md). Calibri /
// Atkinson Hyperlegible at 20px, italic non-bold titles, browser-blue links underlined on hover,
// muted dates and #tags, hairline frames, no shadows or cards. Every other starting point is another
// blog's own saved look (see the style tab).
export const DEFAULT_LOOK = {
  font: "archizzl",
  size: "20px",
  titleSize: "2em",
  titleWeight: "400",
  titleStyle: "italic",
  date: "faded",
  link: "#0000ee",
  underline: "hover",
  corners: "0",
  frame: "none",
  accent: "#000000",
  siteBg: "#ffffff",
  siteText: "#000000",
  siteFont: "archizzl",
};

// A look as stored on KMP: only known settings, each with an allowed value.
export function cleanLook(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const c of [...CONTROLS, ...SITE_CONTROLS]) {
    const v = input[c.key];
    if (v === undefined || v === "") continue;
    if (c.type === "select" ? Object.hasOwn(c.options, v) : /^#[0-9a-f]{6}$/i.test(v)) out[c.key] = String(v);
  }
  return out;
}

// A preset can set the preview's stand-in page too (keys starting with "site").
export function cssFrom(s) {
  const rules = new Map();
  const add = (sel, prop, value) => {
    if (!rules.has(sel)) rules.set(sel, []);
    rules.get(sel).push(`${prop}: ${value};`);
  };

  // writing: set on the whole embed, so tag buttons, headings and tags match the posts' font
  if (s.font) add(".kmp-embed", "font-family", FONT_STACKS[s.font]);
  if (s.size) add(".kmp-embed", "font-size", s.size);
  if (s.leading) add(".kmp-embed", "line-height", s.leading);
  if (s.text) add(".kmp-embed", "color", s.text);
  if (s.width) { add(".kmp-post", "max-width", s.width); add(".kmp-post", "margin-left", "auto"); add(".kmp-post", "margin-right", "auto"); }
  if (s.align) add(".kmp-body", "text-align", s.align);

  // titles
  if (s.titleSize) add(".kmp-title", "font-size", s.titleSize);
  if (s.titleWeight) add(".kmp-title", "font-weight", s.titleWeight);
  if (s.titleStyle === "italic") add(".kmp-title", "font-style", "italic");
  if (s.titleStyle === "upper") { add(".kmp-title", "text-transform", "uppercase"); add(".kmp-title", "letter-spacing", "0.03em"); }
  if (s.titleStyle === "lower") add(".kmp-title", "text-transform", "lowercase");
  if (s.titleAlign) { add(".kmp-title", "text-align", s.titleAlign); add(".kmp-date", "text-align", s.titleAlign); }
  if (s.titleColor) add(".kmp-title", "color", s.titleColor);
  if (s.titleFont) add(".kmp-title", "font-family", FONT_STACKS[s.titleFont]);
  if (s.titleColor || s.titleStyle || s.titleWeight) { add(".kmp-title a", "color", "inherit"); add(".kmp-title a", "text-decoration", "none"); }

  // dates
  if (s.date === "faded") { add(".kmp-date", "opacity", "0.55"); add(".kmp-date", "font-size", "0.8em"); }
  if (s.date === "italic") { add(".kmp-date", "font-style", "italic"); add(".kmp-date", "opacity", "0.75"); }
  if (s.date === "badge") {
    add(".kmp-date", "display", "inline-block");
    add(".kmp-date", "font-size", "0.75em");
    add(".kmp-date", "padding", "0.1em 0.7em");
    add(".kmp-date", "border-radius", "99px");
    add(".kmp-date", "background", s.tagColor || "rgba(0, 0, 0, 0.07)");
    add(".kmp-date", "opacity", "1");
  }
  if (s.date === "hidden") add(".kmp-date", "display", "none");

  // links
  if (s.link) add(".kmp-body a", "color", s.link);
  if (s.underline === "always") add(".kmp-body a", "text-decoration", "underline");
  if (s.underline === "hover" || s.underline === "never") add(".kmp-body a", "text-decoration", "none");
  if (s.underline === "hover") add(".kmp-body a:hover", "text-decoration", "underline");

  // tags (on posts, and the filter buttons, which should match)
  const tagSel = ".kmp-tag, .kmp-menu button";
  const tc = s.tagColor;
  if (s.tags === "outline") { add(tagSel, "border", `1px solid ${tc || "currentColor"}`); add(tagSel, "border-radius", "99px"); add(tagSel, "background", "transparent"); if (tc) add(tagSel, "color", tc); }
  if (s.tags === "filled") { add(tagSel, "border", "1px solid transparent"); add(tagSel, "border-radius", "99px"); add(tagSel, "background", tc || "rgba(0, 0, 0, 0.08)"); add(tagSel, "color", "inherit"); }
  if (s.tags === "square") { add(tagSel, "border", `1px solid ${tc || "currentColor"}`); add(tagSel, "border-radius", "0"); add(tagSel, "text-transform", "uppercase"); add(tagSel, "font-size", "0.75em"); add(tagSel, "letter-spacing", "0.05em"); }
  if (s.tags) {
    // Pills and labels replace the default #tag look: no "#", full strength, a little padding.
    add(tagSel, "padding", "0.05em 0.7em");
    add(tagSel, "opacity", "1");
    add(tagSel, "display", "inline-block");
    add(tagSel, "margin", "0 0.3em 0.3em 0");
    add(".kmp-tag::before, .kmp-menu button::before", "content", "none");
    add('.kmp-menu button[aria-pressed="true"]', "outline", `2px solid ${s.text || "currentColor"}`);
    add('.kmp-menu button[aria-pressed="true"]', "outline-offset", "1px");
    add('.kmp-menu button[aria-pressed="true"]', "font-weight", "bold");
    add('.kmp-menu button[aria-pressed="true"]', "text-decoration", "none");
  }
  if (!s.tags && tc) { add(".kmp-tag, .kmp-menu button", "color", tc); add(".kmp-tag, .kmp-menu button", "opacity", "1"); }

  // photos
  const img = ".kmp-body img, .kmp-image img";
  if (s.corners) add(img, "border-radius", s.corners);
  if (s.frame === "none") { add(img, "border", "0"); add(img, "box-shadow", "none"); }
  if (s.frame === "thin") add(img, "border", "1px solid currentColor");
  if (s.frame === "thick") add(img, "border", "3px solid currentColor");
  if (s.frame === "polaroid") { add(img, "border", "10px solid #fff"); add(img, "border-bottom-width", "34px"); add(img, "box-shadow", "0 1px 4px rgba(0, 0, 0, 0.25)"); }
  if (s.frame === "shadow") add(img, "box-shadow", "0 6px 24px rgba(0, 0, 0, 0.25)");
  if (s.photoWidth) { add(img, "width", s.photoWidth); add(img, "display", "block"); add(img, "margin-left", "auto"); add(img, "margin-right", "auto"); }

  // posts
  if (s.gap) add(".kmp-post", "margin-bottom", s.gap);
  if (s.divider === "line" || s.divider === "dashed") {
    add(".kmp-post + .kmp-post", "border-top", `1px ${s.divider === "dashed" ? "dashed" : "solid"} currentColor`);
    add(".kmp-post + .kmp-post", "padding-top", s.gap || "2em");
  }
  if (s.divider === "dots") {
    add(".kmp-post + .kmp-post::before", "content", '"· · ·"');
    add(".kmp-post + .kmp-post::before", "display", "block");
    add(".kmp-post + .kmp-post::before", "text-align", "center");
    add(".kmp-post + .kmp-post::before", "margin-bottom", "1.5em");
    add(".kmp-post + .kmp-post::before", "letter-spacing", "0.5em");
  }
  if (s.card) { add(".kmp-post", "background", s.card); add(".kmp-post", "padding", "1.2em 1.5em"); }
  if (s.cardEdge === "line" || s.cardEdge === "both") add(".kmp-post", "border", "1px solid currentColor");
  if (s.cardEdge === "round" || s.cardEdge === "both") add(".kmp-post", "border-radius", "14px");
  if (s.cardEdge && !s.card) add(".kmp-post", "padding", "1.2em 1.5em");

  // boxes and quotes
  if (s.accent) { add(".kmp-body .box", "border-color", s.accent); add(".kmp-body blockquote", "border-left-color", s.accent); }
  if (s.boxFill) add(".kmp-body .box", "background", s.boxFill);

  return [...rules].map(([sel, props]) => `${sel} {\n  ${props.join("\n  ")}\n}`).join("\n\n");
}

export const siteFontStack = key => FONT_STACKS[key] || FONT_STACKS.archizzl;

// A blog's look, limited to its own posts on KMP's pages (the front page, /<blog>, single posts),
// where each post sits in <div class="kmp-embed" data-blog="…">. Only the look's own CSS: the
// "your site" stand-ins stay in the style tab's preview, so there's no box or background here.
export function scopedCss(look, scope) {
  return cssFrom(cleanLook(look)).replace(/^([^\s{}][^{}]*?) \{$/gm, (m, sels) =>
    sels
      .split(",")
      .map(x => x.trim())
      .map(x => (x.startsWith(".kmp-embed") ? scope + x.slice(".kmp-embed".length) : `${scope} ${x}`))
      .join(", ") + " {"
  );
}
