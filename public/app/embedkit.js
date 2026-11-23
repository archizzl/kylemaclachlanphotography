// The embed builder's choices, turned into an embed code. No page code here, so the tests can
// import it. Options left at their defaults write no attribute, so codes stay short.

const attrEsc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// o: { origin, cdnBase, user, show: "list" | "post" | "photo",
//      count, sort, filters: { fieldKey: value }, menu, menuLabel, group,   (list)
//      post, postTitle,                                                     (post)
//      photo, photoUrl, photoAlt, caption,                                  (photo)
//      titles, fields, builtinStyle }                                       (all; true unless false)
export function embedCode(o) {
  const a = [`src="${o.origin}/embed.js"`, `data-user="${attrEsc(o.user)}"`];
  let fallback = "";
  if (o.show === "post") {
    a.push(`data-post="${attrEsc(o.post)}"`);
    fallback = `<noscript><a href="${o.cdnBase}/${o.user}/posts/${attrEsc(o.post)}.md">${attrEsc(o.postTitle || o.post)}</a></noscript>`;
  } else if (o.show === "photo") {
    a.push(`data-image="${attrEsc(o.photo)}"`);
    if (o.caption === false) a.push(`data-caption="no"`);
    if (o.photoUrl) fallback = `<noscript><img src="${attrEsc(o.photoUrl)}" alt="${attrEsc(o.photoAlt)}"></noscript>`;
  } else {
    a.push(`data-list="${Number(o.count) || 10}"`);
    const filters = Object.entries(o.filters || {}).filter(([, v]) => v !== "" && v != null);
    if (filters.length) a.push(`data-filter="${attrEsc(filters.map(([k, v]) => `${k}:${v}`).join(","))}"`);
    if (o.sort) a.push(`data-sort="${attrEsc(o.sort)}"`);
    if (o.menu) {
      a.push(`data-menu="${attrEsc(o.menu)}"`);
      if (o.menuLabel) a.push(`data-menu-label="${attrEsc(o.menuLabel)}"`);
    }
    if (o.group) a.push(`data-group="${attrEsc(o.group)}"`);
  }
  if (o.show !== "photo") {
    if (o.titles === false) a.push(`data-title="no"`);
    if (o.fields === false) a.push(`data-fields="no"`);
  }
  if (o.builtinStyle === false) a.push(`data-style="none"`);
  a.push("async");
  return `<script ${a.join(" ")}></script>` + (fallback ? `\n${fallback}` : "");
}

// The orders a list can have: newest first (the default), oldest first, and by any number or text field.
export function sortChoices(fields = []) {
  const out = [["", "newest first"], ["date", "oldest first"]];
  for (const f of fields) {
    if (f.kind === "number") out.push([f.key, `${f.name}: low to high`], [`-${f.key}`, `${f.name}: high to low`]);
    if (f.kind === "text") out.push([f.key, `${f.name}: A to Z`], [`-${f.key}`, `${f.name}: Z to A`]);
  }
  return out;
}
