// Markdown to HTML for posts. Used for saving, the dashboard preview, the embeds and the feeds,
// so everyone sees the same thing.
//
// Typed HTML is shown as text (html: false), and markdown-it's own link check refuses
// javascript:, vbscript:, file: and non-image data: links.

import MarkdownIt from "markdown-it";

// breaks: a single Enter is a line break, as people expect (and poems need).
// typographer is off: what people type is what readers see ("--" stays "--", quotes stay straight).
const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: true });

// Two extras, from archizzl.com's blog format:
//   [[text]]    a small box around inline text   -> <span class="box">text</span>
//   ++text++    underline                         -> <u>text</u>
// Both can hold other formatting, like [[No ***Q*** train]].
function wrapRule(name, open, close, tag, attrs) {
  return (state, silent) => {
    const start = state.pos;
    const src = state.src;
    if (!src.startsWith(open, start)) return false;
    const end = src.indexOf(close, start + open.length);
    if (end < 0 || end === start + open.length) return false;
    if (!silent) {
      const t = state.push(`${name}_open`, tag, 1);
      for (const [k, v] of attrs) t.attrSet(k, v);
      const oldMax = state.posMax;
      state.pos = start + open.length;
      state.posMax = end;
      state.md.inline.tokenize(state);
      state.posMax = oldMax;
      state.push(`${name}_close`, tag, -1);
    }
    state.pos = end + close.length;
    return true;
  };
}
md.inline.ruler.before("link", "box", wrapRule("box", "[[", "]]", "span", [["class", "box"]]));
md.inline.ruler.before("emphasis", "underline", wrapRule("underline", "++", "++", "u", []));

// Links open normally but don't hand the friend's page to the target.
const defaultLink = md.renderer.rules.link_open || ((tokens, i, options, env, self) => self.renderToken(tokens, i, options));
md.renderer.rules.link_open = (tokens, i, options, env, self) => {
  const href = tokens[i].attrGet("href") || "";
  if (/^https?:/i.test(href)) tokens[i].attrSet("rel", "noopener");
  return defaultLink(tokens, i, options, env, self);
};

// Images load lazily so long posts don't slow down the friend's page.
const defaultImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, i, options, env, self) => {
  tokens[i].attrSet("loading", "lazy");
  return defaultImage(tokens, i, options, env, self);
};

export function renderMarkdown(text) {
  return md.render(String(text || ""));
}

// One line of markdown (bold, italics, links) with no paragraph around it, for captions.
export function renderInline(text) {
  return md.renderInline(String(text || ""));
}

// Plain-text opening of a post, for feed summaries.
export function excerpt(text, max = 200) {
  const plain = String(text || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? plain.slice(0, max).replace(/\s+\S*$/, "") + "…" : plain;
}
