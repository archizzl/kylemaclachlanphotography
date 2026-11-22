// Markdown to HTML for posts. Used for saving, the dashboard preview, the embeds and the feeds,
// so everyone sees the same thing.
//
// Typed HTML is shown as text (html: false), and markdown-it's own link check refuses
// javascript:, vbscript:, file: and non-image data: links.

import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false });

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
