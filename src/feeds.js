// What other sites read: the post JSON behind embed.js, RSS and JSON Feed.
// Only published posts ever reach these functions.

import { excerpt } from "./markdown.js";
import { parseJson, publicFields } from "./fields.js";

const xml = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

export const postMdKey = (username, slug) => `${username}/posts/${slug}.md`;

// The text file published alongside each post, so it has a plain URL too.
export function postMarkdownFile(post) {
  return `# ${post.title}\n\n${post.date}\n\n${post.body_md}\n`;
}

// Where a post lives on the friend's own site, if they told us; otherwise its .md file.
export function postLink(user, post, cdnBase) {
  if (user.post_url_pattern) return user.post_url_pattern.replace("{slug}", encodeURIComponent(post.slug));
  return `${cdnBase}/${postMdKey(user.username, post.slug)}`;
}

const defsOf = user => parseJson(user.fields_json, []);

export function publicUser(user) {
  return {
    username: user.username,
    name: user.display_name || user.username,
    site: user.site_url || null,
    // The blog's post fields, so embeds can label values and build menus in the blog's own order.
    // An open tag field's list isn't shared: it can include tags only used on drafts. Menus are
    // built from the published posts instead.
    fields: defsOf(user).map(({ key, name, kind, choices, open }) =>
      open ? { key, name, kind, open } : choices ? { key, name, kind, choices } : { key, name, kind }
    ),
  };
}

// All of a post's tags (from every tags field), for feed categories.
export function fieldTags(user, post) {
  const values = publicFields(defsOf(user), parseJson(post.fields_json, {}));
  return defsOf(user)
    .filter(d => d.kind === "tags" && values[d.key])
    .flatMap(d => values[d.key]);
}

export function publicPost(user, post, cdnBase) {
  return {
    slug: post.slug,
    title: post.title,
    date: post.date,
    updated: post.updated_at,
    html: post.body_html,
    url: postLink(user, post, cdnBase),
    markdown_url: `${cdnBase}/${postMdKey(user.username, post.slug)}`,
    fields: publicFields(defsOf(user), parseJson(post.fields_json, {})),
  };
}

export function publicImage(file, cdnBase, captionHtml) {
  return {
    name: file.name,
    url: `${cdnBase}/${file.key}`,
    alt: file.alt || "",
    caption_html: captionHtml || "",
    width: file.width || null,
    height: file.height || null,
  };
}

const rfc822 = date => new Date(`${date}T12:00:00Z`).toUTCString();

export function rssFeed(user, posts, { origin, cdnBase }) {
  const name = user.display_name || user.username;
  const home = user.site_url || origin;
  const items = posts
    .map(
      p => `    <item>
      <title>${xml(p.title)}</title>
      <link>${xml(postLink(user, p, cdnBase))}</link>
      <guid isPermaLink="false">${xml(`${origin}/${user.username}/${p.id}`)}</guid>
      <pubDate>${rfc822(p.date)}</pubDate>${fieldTags(user, p).map(t => `
      <category>${xml(t)}</category>`).join("")}
      <description>${xml(p.body_html)}</description>
    </item>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(name)}</title>
    <link>${xml(home)}</link>
    <description>${xml(`posts by ${name}`)}</description>
    <atom:link href="${xml(`${origin}/${user.username}/feed.xml`)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

export function jsonFeed(user, posts, { origin, cdnBase }) {
  const name = user.display_name || user.username;
  return {
    version: "https://jsonfeed.org/version/1.1",
    title: name,
    home_page_url: user.site_url || origin,
    feed_url: `${origin}/${user.username}/feed.json`,
    authors: [{ name }],
    items: posts.map(p => ({
      id: `${origin}/${user.username}/${p.id}`,
      url: postLink(user, p, cdnBase),
      title: p.title,
      content_html: p.body_html,
      summary: excerpt(p.body_md),
      tags: fieldTags(user, p),
      date_published: `${p.date}T12:00:00Z`,
      date_modified: p.updated_at,
    })),
  };
}
