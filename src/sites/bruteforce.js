/*
 * bruteforce.kylemaclachlanphotography.org: a hand-made photo site for the bruteforce blog,
 * served by the kmp-previews Worker (src/preview.js, SITES). It shows the blog's photos from its
 * file store, newest first: two side by side, and every photo in a row along the bottom.
 *   click the right photo (or →): one back, to older photos
 *   click the left photo (or ←): one forward, to newer photos
 *   click a photo in the row: show it on the left
 * It wraps around at either end. New uploads show up within a minute (the page is cached for 60s).
 */

import { escapeHtml as e } from "../util.js";

export const BRUTEFORCE = { username: "bruteforce", title: "BRUTE FORCE" };

export function bruteforcePage({ title, photos }, { cdnBase }) {
  const list = photos.map(f => ({ src: `${cdnBase}/${f.key}`, alt: f.alt || "" }));
  const img = (p, side) => (p ? `<img class="${side}" src="${e(p.src)}" alt="${e(p.alt)}">` : "");
  const first = list[0];
  const second = list.length > 1 ? list[1] : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${e(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Eater&display=swap">
<style>
  :root { --bg: #E7BBD8; --head: #B42D58; --text: #596157; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--text); }
  body { font-family: Georgia, serif; min-height: 100svh; }
  h1 {
    margin: 0; padding: 10px 16px 18px; text-align: center;
    font-family: "Eater", Georgia, serif; font-weight: 400; font-size: clamp(36px, 5vw, 64px); line-height: 1;
    color: var(--head); text-shadow: 2px 2px 0 var(--text);
  }
  ::selection { background: var(--text); color: var(--bg); }
  /* Two photos, as tall as the window allows above the row of thumbnails. */
  .pair { display: flex; justify-content: center; padding: 0 16px; height: min(calc(100svh - 200px), (100vw - 32px) * 2 / 3); }
  .pair img { display: block; height: 100%; width: auto; max-width: 50%; object-fit: contain; cursor: pointer; user-select: none; -webkit-user-drag: none; }
  .row { display: flex; overflow-x: auto; margin-top: 6px; scrollbar-width: none; }
  .row button { flex: none; padding: 0; border: 0; background: none; cursor: pointer; }
  .row img { display: block; width: 84px; height: 88px; object-fit: cover; }
  .empty { text-align: center; }
</style>
</head>
<body>
<h1>${e(title)}</h1>
${
  list.length
    ? `<main class="pair" aria-live="polite">${img(first, "left")}${img(second, "right")}</main>
<nav class="row" aria-label="all photos">${list
        .map((p, i) => `<button type="button" data-i="${i}" aria-label="photo ${i + 1} of ${list.length}"><img src="${e(p.src)}" alt="" loading="lazy"></button>`)
        .join("")}</nav>
<script>
(() => {
  const photos = ${JSON.stringify(list).replace(/</g, "\\u003c")};
  const n = photos.length;
  const pair = document.querySelector(".pair");
  const left = pair.querySelector(".left");
  const right = pair.querySelector(".right");
  let at = 0; // the photo on the left; the one after it is on the right
  const set = (img, p) => { if (img.getAttribute("src") !== p.src) { img.src = p.src; img.alt = p.alt; } };
  function show(i) {
    at = ((i % n) + n) % n;
    set(left, photos[at]);
    if (right) set(right, photos[(at + 1) % n]);
    // Fetch the next ones over so clicking through is instant.
    for (const j of [at - 1, at + 2]) new Image().src = photos[((j % n) + n) % n].src;
  }
  if (n > 1) {
    left.addEventListener("click", () => show(at - 1));
    right.addEventListener("click", () => show(at + 1));
    addEventListener("keydown", ev => {
      if (ev.key === "ArrowRight") show(at + 1);
      else if (ev.key === "ArrowLeft") show(at - 1);
    });
  }
  document.querySelector(".row").addEventListener("click", ev => {
    const b = ev.target.closest("button");
    if (b) show(Number(b.dataset.i));
  });
})();
</script>`
    : `<p class="empty">no photos yet.</p>`
}
</body>
</html>`;
}
