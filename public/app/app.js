// The friend dashboard: posts, files, embed, style, settings. Talks to /api/* in src/worker.js.

import { CONTROLS, DEFAULT_LOOK, SITE_CONTROLS, cssFrom, siteFontStack } from "./stylekit.js";
import { embedCode, sortChoices } from "./embedkit.js";

const { username, cdnBase, origin } = window.KMP;
const app = document.getElementById("app");
const MAX_SIDE = 2400; // photos are shrunk to this many pixels on the long edge before upload

let me = null;
let dirty = false; // unsaved edits in the post editor

// ---- helpers ----

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const $ = sel => app.querySelector(sel);

async function api(path, { method = "GET", body, headers = {} } = {}) {
  const isBlob = body instanceof Blob;
  const res = await fetch(`/api/${path}`, {
    method,
    headers: { "x-kmp": "1", ...(body && !isBlob ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : isBlob ? body : JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401) { location.href = "/login"; throw new Error(data.error); }
  if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

let toastTimer;
function toast(text, bad = false) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  t.textContent = text;
  t.className = `show${bad ? " bad" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), bad ? 5000 : 2200);
}

async function copy(text, what = "copied") {
  try { await navigator.clipboard.writeText(text); toast(what); } catch { prompt("copy this:", text); }
}

// "No. 3 · tender, hopeful · the 14 bus stop": a post's field values in the blog's field order.
function fieldSummary(values = {}) {
  return (me?.fields || [])
    .filter(d => values[d.key] !== undefined)
    .map(d => (d.kind === "tags" ? values[d.key].join(", ") : d.kind === "number" ? `${d.name} ${values[d.key]}` : values[d.key]))
    .join(" · ");
}

const kb = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const embedOrigin = origin;

function postSnippet(post) {
  return `<script src="${embedOrigin}/embed.js" data-user="${username}" data-post="${post.slug}" async></script>
<noscript><a href="${cdnBase}/${username}/posts/${post.slug}.md">${esc(post.title)}</a></noscript>`;
}

function imageSnippet(f) {
  return `<script src="${embedOrigin}/embed.js" data-user="${username}" data-image="${f.name}" async></script>
<noscript><img src="${f.url}" alt="${esc(f.alt || "")}"></noscript>`;
}
const imgTag = f =>
  `<img src="${f.url}" alt="${esc(f.alt || "")}"${f.width ? ` width="${f.width}" height="${f.height}"` : ""} style="max-width:100%;height:auto">`;

// choices: one embed code, or a list of { label, code, note } to pick from.
function showSnippet(title, choices, extra = "") {
  const list = typeof choices === "string" ? [{ code: choices }] : choices;
  const d = document.createElement("dialog");
  d.innerHTML = `<h2>${esc(title)}</h2>
    ${list.length === 1 ? `<p class="muted">paste this into your page wherever it should show up. it updates by itself when you edit here.</p>` : ""}
    ${list
      .map(
        (c, i) => `${c.label ? `<h3 style="margin:14px 0 2px;font-size:1em">${esc(c.label)}</h3>` : ""}
      ${c.note ? `<p class="muted" style="margin:0 0 4px">${c.note}</p>` : ""}
      <textarea readonly>${esc(c.code)}</textarea>
      <div class="toolbar"><button class="${i === 0 ? "primary" : ""}" data-copy-snippet="${i}">copy</button></div>`
      )
      .join("")}
    ${extra}
    <div class="toolbar"><button data-act="close">close</button></div>`;
  d.addEventListener("click", ev => {
    const i = ev.target.dataset.copySnippet;
    if (i !== undefined) copy(list[i].code, "embed code copied");
    if (ev.target.dataset.act === "close" || ev.target === d) d.close();
  });
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  d.showModal();
  d.querySelector("textarea").select();
}

// ---- layout ----

function frame(active, inner) {
  const tab = (id, label) => `<a href="#${id}" class="${active === id ? "on" : ""}">${label}</a>`;
  document.querySelectorAll("dialog").forEach(d => d.remove());
  // ↗ goes to the friend's own site if they've set one, then their preview site, then their page here.
  const outside = me?.site_url || me?.preview || `/${username}`;
  const outsideTitle = me?.site_url ? "your site" : me?.preview ? "your preview site" : "your blog on kylemaclachlanphotography.org";
  app.innerHTML = `<header class="top"><h1>${esc(me?.display_name || username)}<a class="out" href="${esc(outside)}" target="_blank" rel="noopener" title="${outsideTitle}">↗</a></h1>
    <nav>${tab("posts", "posts")}${tab("files", "files")}${tab("embed", "embed")}${tab("style", "style")}${tab("settings", "settings")}<a href="/" title="the front page with every blog (you stay logged in)">front page</a><a href="/logout">log out</a></nav></header>
    <main>${inner}</main>`;
}

window.addEventListener("hashchange", () => {
  if (dirty && !confirm("You have unsaved changes. Leave without saving?")) return;
  dirty = false;
  render();
});
window.addEventListener("beforeunload", ev => { if (dirty) { ev.preventDefault(); ev.returnValue = ""; } });

async function render() {
  const [view, id, extra] = (location.hash.slice(1) || "posts").split("/").map(decodeURIComponent);
  try {
    if (!me) me = await api("me");
    if (view === "files") return await filesView();
    if (view === "settings") return settingsView();
    if (view === "style") return await styleView();
    if (view === "embed") return await embedView(id, extra);
    if (view === "edit") return await editView(id);
    return await postsView();
  } catch (err) {
    frame(view, `<p class="problem">${esc(err.message)}</p>`);
  }
}

// ---- posts ----

async function postsView() {
  const { posts } = await api("posts");
  const items = posts
    .map(
      p => `<li>
        <div class="grow"><a href="#edit/${p.id}">${esc(p.title)}</a><time>${esc(p.date)}</time>
          ${fieldSummary(p.fields) ? `<div class="muted">${esc(fieldSummary(p.fields))}</div>` : ""}</div>
        ${p.published ? '<span class="live">published</span>' : '<span class="draft">draft</span>'}
        <div class="buttons">
          ${p.published ? `<button data-embed="${p.id}">embed code</button>` : ""}
          <button class="danger" data-del="${p.id}">delete</button>
        </div></li>`
    )
    .join("");
  frame(
    "posts",
    `<div class="toolbar"><a class="button primary" href="#edit/new">new post</a>
      <a class="button" href="#embed">embed my posts</a></div>
    ${posts.length ? `<ul class="list">${items}</ul>` : `<p>no posts yet. <a href="#edit/new">write your first one</a>.</p>`}`
  );
  app.onclick = async ev => {
    const t = ev.target;
    if (t.dataset.embed) location.hash = `#embed/post/${encodeURIComponent(posts.find(p => p.id == t.dataset.embed).slug)}`;
    if (t.dataset.del) {
      const p = posts.find(x => x.id == t.dataset.del);
      if (!confirm(`Delete "${p.title}"? This can't be undone, and it disappears from every page it's embedded in.`)) return;
      try { await api(`posts/${p.id}`, { method: "DELETE" }); toast("deleted"); render(); } catch (err) { toast(err.message, true); }
    }
  };
}

async function editView(id) {
  const isNew = id === "new";
  let post = isNew ? { title: "", slug: "", date: new Date().toISOString().slice(0, 10), body_md: "", published: 0 } : (await api(`posts/${id}`)).post;
  let slugTouched = !isNew;

  frame(
    "posts",
    `<p><a href="#posts">← all posts</a></p>
    <div class="row">
      <label style="flex:3 1 300px">title <input id="title" value="${esc(post.title)}" placeholder="my first post"></label>
      <label style="flex:1 1 140px">date <input id="date" type="date" value="${esc(post.date)}"></label>
    </div>
    <label class="muted" style="margin-top:8px">address <input id="slug" value="${esc(post.slug)}" placeholder="my-first-post" spellcheck="false" autocapitalize="none"></label>
    ${fieldInputs(me.fields || [], post.fields || {}, isNew)}
    <div class="toolbar">
      <button id="img">insert photo</button>
      <input id="imgfile" type="file" accept="image/*" multiple hidden>
      <span style="flex:1"></span>
      <span class="status" id="status"></span>
      <button id="draft"></button>
      <button id="publish" class="primary"></button>
    </div>
    <div class="editor">
      <textarea id="body" placeholder="write here. a blank line starts a new paragraph. drag or paste photos in." aria-label="post text">${esc(post.body_md)}</textarea>
      <div class="preview" id="preview" aria-live="polite"></div>
    </div>
    <p class="cheats"><code>**bold**</code> <code>*italic*</code> <code>[link text](https://…)</code> <code>## heading</code>
      <code>- list item</code> <code>&gt; quote</code> <code>![description](photo url)</code> <code>++underline++</code> <code>~~strike~~</code> <code>[[box]]</code>. html is shown as plain text.</p>`
  );
  app.onclick = null;

  const title = $("#title"), slug = $("#slug"), body = $("#body"), date = $("#date"), status = $("#status");
  const slugify = s => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

  function buttons() {
    $("#draft").textContent = post.published ? "unpublish" : "save draft";
    $("#publish").textContent = post.published ? "save" : "publish";
  }
  buttons();

  let previewTimer;
  async function preview() {
    try { $("#preview").innerHTML = (await api("preview", { method: "POST", body: { body: body.value } })).html; } catch {}
  }
  const changed = () => { dirty = true; status.textContent = "not saved"; };
  title.addEventListener("input", () => { if (!slugTouched) slug.value = slugify(title.value); changed(); });
  slug.addEventListener("input", () => { slugTouched = true; changed(); });
  date.addEventListener("input", changed);
  $("#postfields")?.addEventListener("input", changed);
  setupTagInputs($("#postfields"), me.fields || [], changed);
  body.addEventListener("input", () => { changed(); clearTimeout(previewTimer); previewTimer = setTimeout(preview, 350); });
  preview();

  async function save(published) {
    const payload = { title: title.value, slug: slug.value, date: date.value, body: body.value, published, fields: readFieldInputs(me.fields || []) };
    status.textContent = "saving…";
    try {
      const saved = (await api(isNew && !post.id ? "posts" : `posts/${post.id}`, { method: isNew && !post.id ? "POST" : "PUT", body: payload })).post;
      const wasPublished = post.published;
      post = saved;
      dirty = false;
      slug.value = post.slug;
      slugTouched = true;
      // Auto numbers are filled in by the server on the first save.
      for (const d of me.fields || []) {
        const box = document.getElementById(`field-${d.key}`);
        if (d.kind === "number" && box && post.fields?.[d.key] !== undefined) box.value = post.fields[d.key];
      }
      // New tags typed into an open tag field are now part of its list: redraw it as chips.
      if ((me.fields || []).some(d => d.open)) {
        me = await api("me");
        $("#postfields").outerHTML = fieldInputs(me.fields, post.fields || {}, false);
        $("#postfields")?.addEventListener("input", changed);
        setupTagInputs($("#postfields"), me.fields || [], changed);
      }
      status.textContent = "saved";
      buttons();
      if (location.hash !== `#edit/${post.id}`) history.replaceState(null, "", `#edit/${post.id}`);
      if (published && !wasPublished) {
        showSnippet("published!", postSnippet(post), `<p class="muted">it's also in your feeds, and the text is at <a href="${cdnBase}/${username}/posts/${post.slug}.md" target="_blank">${esc(`${username}/posts/${post.slug}.md`)}</a>.</p>`);
      } else toast(published ? "saved. embeds update within a minute." : wasPublished ? "unpublished. it's hidden everywhere now." : "draft saved");
    } catch (err) {
      status.textContent = "not saved";
      toast(err.message, true);
    }
  }
  $("#draft").onclick = () => save(0);
  $("#publish").onclick = () => save(1);
  body.addEventListener("keydown", ev => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === "s") { ev.preventDefault(); save(post.published); }
  });

  // Photos can come from the "insert photo" button, from dragging them onto the editor, or from
  // pasting them. Each is shrunk, uploaded, and added where the cursor is, on its own line.
  async function insertPhotos(files) {
    const photos = [...files].filter(f => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (!photos.length) return;
    let added = 0;
    for (const [i, file] of photos.entries()) {
      status.textContent = photos.length > 1 ? `uploading photo ${i + 1} of ${photos.length}…` : "uploading photo…";
      try {
        const f = await uploadFile(file);
        const alt = /^image\.(png|jpe?g|gif|webp)$/i.test(file.name) ? "" : file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
        const text = `![${alt}](${f.url})`;
        const at = body.selectionStart ?? body.value.length;
        const before = body.value.slice(0, at), after = body.value.slice(at);
        const pad = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
        body.value = `${before}${pad}${text}\n\n${after}`;
        const caret = (before + pad + text + "\n\n").length;
        body.setSelectionRange(caret, caret); // the next photo goes after this one
        added++;
      } catch (err) {
        toast(`${file.name}: ${err.message}`, true);
      }
    }
    status.textContent = "";
    if (!added) return;
    body.focus();
    changed();
    preview();
    toast(`${added === 1 ? "photo" : `${added} photos`} added. change the words in [ ] to describe ${added === 1 ? "it" : "them"}.`);
  }

  $("#img").onclick = () => $("#imgfile").click();
  $("#imgfile").onchange = ev => {
    const files = [...ev.target.files];
    ev.target.value = "";
    insertPhotos(files);
  };

  // Drag photos onto the writing box or the preview.
  const editor = app.querySelector(".editor");
  const hasFiles = ev => [...(ev.dataTransfer?.types || [])].includes("Files");
  let depth = 0;
  editor.addEventListener("dragenter", ev => { if (hasFiles(ev)) { depth++; editor.classList.add("dropping"); } });
  editor.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; editor.classList.remove("dropping"); } });
  editor.addEventListener("dragover", ev => { if (hasFiles(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = "copy"; } });
  editor.addEventListener("drop", ev => {
    if (!hasFiles(ev)) return; // dragging text around stays normal
    ev.preventDefault();
    depth = 0;
    editor.classList.remove("dropping");
    insertPhotos(ev.dataTransfer.files);
  });

  // Paste a photo (a screenshot, or one copied from another page).
  body.addEventListener("paste", ev => {
    const files = [...(ev.clipboardData?.files || [])].filter(f => f.type.startsWith("image/"));
    if (!files.length) return; // ordinary text pastes as usual
    ev.preventDefault();
    insertPhotos(files);
  });
}

// ---- post fields in the editor ----

function fieldInputs(defs, values, isNew) {
  if (!defs.length) return `<p class="muted" style="font-size:15px">want tags, numbers or a location on your posts? set them up in <a href="#settings">settings</a>.</p>`;
  return `<fieldset id="postfields" class="postfields">${defs
    .map(d => {
      const v = values[d.key];
      if (d.kind === "tags") {
        // Just this post's tags, plus a box to type more; matching tags drop down as you type.
        return `<div class="pf"><span class="pf-name">${esc(d.name)}</span>
          <div class="taginput" data-key="${esc(d.key)}" data-values="${esc(JSON.stringify(v || []))}">
            <span class="chosen"></span>
            <input class="tagtyper" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-autocomplete="list"
              aria-label="add ${esc(d.name)}" placeholder="${d.open ? "type a tag…" : `type to add ${esc(d.name)}…`}">
            <ul class="suggest" role="listbox" hidden></ul>
          </div></div>`;
      }
      if (d.kind === "number") {
        const hint = d.auto && isNew ? "counts up by itself" : "";
        return `<label class="pf"><span class="pf-name">${esc(d.name)}</span><input id="field-${esc(d.key)}" type="number" step="any" value="${v ?? ""}" placeholder="${hint}" style="width:12em"></label>`;
      }
      return `<label class="pf"><span class="pf-name">${esc(d.name)}</span><input id="field-${esc(d.key)}" value="${esc(v ?? "")}" style="flex:1"></label>`;
    })
    .join("")}</fieldset>`;
}

function readFieldInputs(defs) {
  const out = {};
  for (const d of defs) {
    if (d.kind === "tags") {
      const box = app.querySelector(`#postfields .taginput[data-key="${CSS.escape(d.key)}"]`);
      const chosen = box ? JSON.parse(box.dataset.values || "[]") : [];
      // Something typed but not added yet still counts (in a fixed list, only if it's on the list).
      const typed = (box?.querySelector(".tagtyper").value || "").split(",").map(s => s.trim()).filter(Boolean)
        .map(t => d.open ? t : d.choices.find(c => c.toLowerCase() === t.toLowerCase()))
        .filter(Boolean);
      out[d.key] = [...chosen, ...typed];
    }
    else {
      const v = document.getElementById(`field-${d.key}`)?.value ?? "";
      if (v !== "") out[d.key] = d.kind === "number" ? Number(v) : v;
    }
  }
  return out;
}

// Tag boxes: chips for the post's tags, a type-ahead dropdown of matching tags, and (in open
// fields) any new tag. Keys: ↓/↑ to move, Enter, Tab or comma to add, Backspace to remove the last.
function setupTagInputs(container, defs, onChange) {
  for (const box of container?.querySelectorAll(".taginput") || []) {
    const def = defs.find(d => d.key === box.dataset.key);
    if (!def) continue;
    const typer = box.querySelector(".tagtyper");
    const list = box.querySelector(".suggest");
    const chosenEl = box.querySelector(".chosen");
    let values = JSON.parse(box.dataset.values || "[]");
    let options = [];
    let active = 0;
    const lower = s => s.toLowerCase();
    const has = t => values.some(v => lower(v) === lower(t));

    function save() {
      box.dataset.values = JSON.stringify(values);
      chosenEl.innerHTML = values
        .map((v, i) => `<span class="chip">${esc(v)}<button type="button" data-remove="${i}" aria-label="remove ${esc(v)}">×</button></span>`)
        .join("");
    }
    function close() {
      list.hidden = true;
      typer.setAttribute("aria-expanded", "false");
    }
    function suggest() {
      const q = typer.value.trim();
      if (!q) return close();
      const lq = lower(q);
      const matches = def.choices
        .filter(c => !has(c) && lower(c).includes(lq))
        .sort((a, b) => lower(b).startsWith(lq) - lower(a).startsWith(lq) || a.localeCompare(b));
      options = matches.map(c => ({ tag: c, label: c }));
      const exact = def.choices.some(c => lower(c) === lq) || has(q);
      if (def.open && !exact) options.push({ tag: q, label: `add “${q}” as a new tag` });
      active = 0;
      list.innerHTML = options.length
        ? options.map((o, i) => `<li role="option" data-i="${i}" class="${i === active ? "on" : ""}${o.label !== o.tag ? " new" : ""}">${esc(o.label)}</li>`).join("")
        : `<li class="none">${has(q) ? "already added" : `no ${esc(def.name)} like that`}</li>`;
      list.hidden = false;
      typer.setAttribute("aria-expanded", "true");
    }
    function add(tag) {
      const known = def.choices.find(c => lower(c) === lower(tag));
      const t = known || (def.open ? tag.trim() : "");
      if (!t || has(t)) return;
      values.push(t);
      save();
      typer.value = "";
      close();
      onChange();
    }
    function highlight(i) {
      active = (i + options.length) % options.length;
      list.querySelectorAll("li[data-i]").forEach(li => li.classList.toggle("on", Number(li.dataset.i) === active));
    }

    typer.addEventListener("input", () => {
      // Typing or pasting "a, b, c" adds the finished ones straight away.
      if (typer.value.includes(",")) {
        const parts = typer.value.split(",");
        const last = parts.pop();
        for (const p of parts) if (p.trim()) add(p.trim());
        typer.value = last.trimStart();
      }
      suggest();
    });
    typer.addEventListener("keydown", ev => {
      if (ev.key === "ArrowDown" && options.length) { ev.preventDefault(); if (list.hidden) suggest(); else highlight(active + 1); }
      else if (ev.key === "ArrowUp" && options.length) { ev.preventDefault(); highlight(active - 1); }
      else if ((ev.key === "Enter" || (ev.key === "Tab" && typer.value.trim())) && !list.hidden && options[active]) { ev.preventDefault(); add(options[active].tag); }
      else if (ev.key === "Enter") ev.preventDefault();
      else if (ev.key === "Escape") close();
      else if (ev.key === "Backspace" && !typer.value && values.length) { values.pop(); save(); onChange(); }
    });
    typer.addEventListener("blur", () => setTimeout(close, 150));
    list.addEventListener("mousedown", ev => {
      const li = ev.target.closest("li[data-i]");
      if (!li) return;
      ev.preventDefault(); // keep focus in the box
      add(options[Number(li.dataset.i)].tag);
      typer.focus();
    });
    chosenEl.addEventListener("click", ev => {
      const i = ev.target.dataset.remove;
      if (i === undefined) return;
      values.splice(Number(i), 1);
      save();
      onChange();
      typer.focus();
    });
    box.addEventListener("click", ev => { if (ev.target === box || ev.target === chosenEl) typer.focus(); });
    save();
  }
}

// ---- setting up post fields ----

function fieldsEditor() {
  let defs = structuredClone(me.fields || []);
  const box = $("#fields");
  const kinds = { tags: "tags to pick from", number: "a number", text: "a bit of text (like a place)" };

  function draw() {
    box.innerHTML = `${defs
      .map(
        (d, i) => `<div class="fielddef" data-i="${i}">
          <div class="row">
            <label>name <input data-k="name" value="${esc(d.name)}" placeholder="emotion"></label>
            <label>kind <select data-k="kind">${Object.entries(kinds).map(([k, l]) => `<option value="${k}"${d.kind === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
            <span class="buttons"><button type="button" data-move="-1" title="move up"${i ? "" : " disabled"}>↑</button><button type="button" data-move="1" title="move down"${i < defs.length - 1 ? "" : " disabled"}>↓</button><button type="button" class="danger" data-remove>remove</button></span>
          </div>
          ${d.kind === "tags" ? `<label>tags, separated by commas <input data-k="choices" value="${esc((d.choices || []).join(", "))}" placeholder="tender, restless, hopeful, giddy"></label>
          <label class="check"><input type="checkbox" data-k="open"${d.open ? " checked" : ""}> let me type new tags while writing (they're added here)</label>` : ""}
          ${d.kind === "number" ? `<label class="check"><input type="checkbox" data-k="auto"${d.auto ? " checked" : ""}> number new posts automatically (1, 2, 3…)</label>` : ""}
          ${d.key ? `<p class="muted" style="margin:4px 0 0;font-size:14px">in embed codes this field is called <code>${esc(d.key)}</code></p>` : ""}
        </div>`
      )
      .join("")}
      <div class="toolbar"><button type="button" data-add>add a field</button>${defs.length || (me.fields || []).length ? `<button type="button" class="primary" data-save>save fields</button>` : ""}</div>`;
  }
  draw();

  box.oninput = box.onchange = ev => {
    const row = ev.target.closest(".fielddef");
    const k = ev.target.dataset.k;
    if (!row || !k) return;
    const d = defs[row.dataset.i];
    if (k === "auto") d.auto = ev.target.checked;
    else if (k === "open") d.open = ev.target.checked;
    else if (k === "choices") d.choices = ev.target.value.split(",").map(s => s.trim()).filter(Boolean);
    else d[k] = ev.target.value;
    if (k === "kind" && ev.type === "change") draw();
  };
  box.onclick = async ev => {
    const t = ev.target;
    const row = t.closest(".fielddef");
    const i = row ? Number(row.dataset.i) : -1;
    if (t.dataset.add !== undefined) { defs.push({ name: "", kind: "tags", choices: [] }); draw(); box.querySelector(".fielddef:last-of-type input")?.focus(); }
    if (t.dataset.remove !== undefined) {
      if (defs[i].key && !confirm(`Remove "${defs[i].name}"? Posts stop showing it.`)) return;
      defs.splice(i, 1); draw();
    }
    if (t.dataset.move) { const j = i + Number(t.dataset.move); [defs[i], defs[j]] = [defs[j], defs[i]]; draw(); }
    if (t.dataset.save !== undefined) {
      try {
        me.fields = (await api("fields", { method: "PUT", body: { fields: defs } })).fields;
        toast("fields saved");
        settingsView();
      } catch (err) { toast(err.message, true); }
    }
  };
}

// ---- costs ----

const money = d => (!d ? "$0.00" : d < 0.005 ? "<$0.01" : `$${d.toFixed(2)}`);
const size = bytes =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : bytes >= 1e3 ? `${Math.round(bytes / 1e3)} KB` : bytes > 0 ? "<1 KB" : "0 KB";
const monthName = (key, partial) =>
  new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) + (partial ? " (so far)" : "");

async function costs() {
  const box = $("#costs");
  try {
    const u = await api("usage");
    const host = esc(u.hostName);
    // Months where nothing was stored, uploaded or paid are left out (this month always shows).
    const shown = u.months.filter(m => m.partial || m.gbMonths > 0 || m.uploads || m.domain);
    const skipped = u.months.length - shown.length;
    const rows = shown
      .map(
        m => {
          // Only storage can be estimated; a month with nothing but a domain payment is exact.
          const est = m.source === "estimated" && (m.gbMonths > 0 || m.uploads > 0);
          return `<tr${est ? ' class="est" title="estimated from your files: cloudflare\'s numbers for this month aren\'t here yet"' : ""}>
          <td>${monthName(m.month, m.partial)}${est ? " · est." : ""}</td>
          <td>${size(m.gbMonths * 1e9)}</td>
          <td>${m.uploads}</td>
          <td>${money(m.fullPrice)}</td>
          <td>${money(m.storageCharged)}</td>
          ${u.domain ? `<td>${m.domain ? money(m.domain) : "–"}</td>` : ""}
          <td><b>${money(m.total)}</b></td>
        </tr>`;
        }
      )
      .join("");
    const t = u.allTime;
    box.innerHTML = `
      <p>you're storing <b>${size(u.stored.files)}</b> of photos and files and <b>${size(u.stored.text)}</b> of writing.</p>
      <p>all time, your blog has cost <b>${money(t.total)}</b>${t.domain ? ` (${money(t.domain)} of it is your domain)` : ""}.
        ${t.fullPrice > t.storageCharged ? `storage would have been ${money(t.fullPrice)} without Cloudflare's free allowance.` : ""}</p>
      ${u.domain ? `<p class="domain-note">your domain <b>${esc(u.domain.name)}</b> is registered through ${host}: ${money(u.domain.yearly)} a year${u.domain.renews ? `, next renewing on ${esc(u.domain.renews)}` : ""}.</p>` : ""}
      <div class="tablewrap"><table class="costs">
        <thead><tr><th>month</th><th>stored (average)</th><th>uploads</th><th>full price</th><th>storage cost</th>${u.domain ? "<th>domain</th>" : ""}<th>total</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>all time</td><td></td><td>${t.uploads}</td><td>${money(t.fullPrice)}</td><td>${money(t.storageCharged)}</td>${u.domain ? `<td>${money(t.domain)}</td>` : ""}<td><b>${money(t.total)}</b></td></tr></tfoot>
      </table></div>
      ${skipped ? `<p class="muted" style="font-size:15px">${skipped} month${skipped === 1 ? "" : "s"} with nothing stored or paid aren't shown.</p>` : ""}
      <p class="muted" style="font-size:15px">how this is worked out: your photos, files and published writing are stored with Cloudflare R2.
        ${u.measuredThrough ? `storage and requests come from cloudflare's own measurements (up to ${esc(u.measuredThrough)}), split between blogs by who stores what. months marked "est." are estimated from your files instead.` : `these are estimates from your files until cloudflare's own measurements are synced.`}
        "full price" is R2's list price: $${u.rates.storagePerGBMonth} per GB a month, $${u.rates.uploadsPerMillion} per million uploads and $${u.rates.readsPerMillion} per million reads.
        every month the first ${u.rates.freeGBMonths} GB, ${(u.rates.freeUploads / 1e6).toFixed(0)} million uploads and ${(u.rates.freeReads / 1e6).toFixed(0)} million reads are free, shared by all of ${host}'s sites, so "storage cost" is your share of anything over that.
        prices from <a href="${esc(u.rates.source)}" target="_blank" rel="noopener">cloudflare</a>, checked ${esc(u.rates.checked)}.</p>`;
  } catch (err) {
    box.innerHTML = `<p class="problem">${esc(err.message)}</p>`;
  }
}

// ---- embed builder ----
// Pick what to show and how, see it with your real posts, copy the code.

async function embedView(kind, which) {
  const [{ posts }, { files }] = await Promise.all([api("posts"), api("files")]);
  const published = posts.filter(p => p.published);
  const photos = files.filter(f => f.content_type.startsWith("image/"));
  const fields = me.fields || [];
  const tagFields = fields.filter(f => f.kind === "tags" && (f.choices || []).length);
  const saved = myLook();
  const look = cssFrom(saved);

  // Opened from a post or photo's "embed code" button: start with that one.
  const o = { show: "list", count: 10, sort: "", filters: {}, menu: "", menuLabel: "", group: "", titles: true, fields: true, builtinStyle: true, caption: true, useLook: Boolean(look) };
  if (kind === "post" && published.some(p => p.slug === which)) Object.assign(o, { show: "post", post: which });
  if (kind === "photo" && photos.some(f => f.name === which)) Object.assign(o, { show: "photo", photo: which });
  o.post ??= published[0]?.slug;
  o.photo ??= photos[0]?.name;

  const sel = (key, options, value) =>
    `<select data-o="${key}">${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const check = (key, label) => `<label class="check"><input type="checkbox" data-o="${key}"${o[key] ? " checked" : ""}> ${esc(label)}</label>`;

  function controls() {
    const show = [["list", "my latest posts"], ["post", "one post"], ["photo", "one photo"]];
    let h = `<label>show ${sel("show", show, o.show)}</label>`;
    if (o.show === "list") {
      h += `<label>how many ${sel("count", [...[5, 10, 20, 50].map(n => [n, `the newest ${n}`]), ["all", "all of them"]], o.count)}</label>`;
      h += `<label>order ${sel("sort", sortChoices(fields), o.sort)}</label>`;
      for (const f of tagFields) {
        h += `<label>only ${esc(f.name)} <select data-filter="${esc(f.key)}"><option value="">any</option>${f.choices
          .map(c => `<option${o.filters[f.key] === c ? " selected" : ""}>${esc(c)}</option>`)
          .join("")}</select></label>`;
      }
      if (tagFields.length) {
        h += `<label>filter buttons ${sel("menu", [["", "none"], ...tagFields.map(f => [f.key, `by ${f.name}`])], o.menu)}</label>`;
        if (o.menu) {
          const f = tagFields.find(x => x.key === o.menu);
          h += `<label>button label <input data-o="menuLabel" value="${esc(o.menuLabel)}" placeholder="${esc(f?.name || "")}"></label>`;
        }
        h += `<label>headings ${sel("group", [["", "none"], ...tagFields.map(f => [f.key, `one per ${f.name}`])], o.group)}</label>`;
      }
    } else if (o.show === "post") {
      h += published.length
        ? `<label>post ${sel("post", published.map(p => [p.slug, p.title]), o.post)}</label>`
        : `<p class="muted">publish a post first.</p>`;
    } else {
      h += photos.length
        ? `<label>photo ${sel("photo", photos.map(f => [f.name, f.name]), o.photo)}</label>${check("caption", "show its caption")}`
        : `<p class="muted">upload a photo first, on the files page.</p>`;
    }
    h += `<fieldset><legend>show with it</legend>`;
    if (o.show !== "photo") h += check("titles", "titles and dates") + (fields.length ? check("fields", "tags and details") : "");
    h += check("builtinStyle", "the built-in light styling") + `</fieldset>`;
    if (look) h += check("useLook", "preview with my look from the style tab");
    return h;
  }

  frame(
    "embed",
    `<p>choose what to show on your site, check it in the preview, then copy the code into your page where it should appear.</p>
    <div class="playground embedder">
      <form class="style-controls" id="eb" autocomplete="off"></form>
      <div class="style-preview"><iframe id="stage" title="preview of the embed"></iframe></div>
    </div>
    <h2>your embed code</h2>
    <p class="muted">paste it into your page's html where the posts should go. it updates by itself when you write or edit here.${look ? ` for your look, also copy the css from the <a href="#style">style</a> tab.` : ` to change how it looks, try the <a href="#style">style</a> tab.`}</p>
    <textarea id="code" class="cssout" readonly style="min-height:90px"></textarea>
    <div class="toolbar"><button class="primary" id="copycode">copy embed code</button></div>`
  );
  app.onclick = null;

  const form = $("#eb");
  const stage = $("#stage");
  const code = () => {
    const post = published.find(p => p.slug === o.post);
    const photo = photos.find(f => f.name === o.photo);
    return embedCode({ ...o, origin, cdnBase, user: username, postTitle: post?.title, photoUrl: photo?.url, photoAlt: photo?.alt });
  };
  let timer;
  function update({ redraw = false } = {}) {
    if (redraw) form.innerHTML = controls();
    const c = code();
    $("#code").value = c;
    clearTimeout(timer);
    timer = setTimeout(() => {
      // With the style tab's look, also use its stand-in for the page around the posts.
      const site = o.useLook ? saved : {};
      const page = `body { margin: 0; padding: 20px; background: ${site.siteBg || "#ffffff"}; color: ${site.siteText || "#111111"}; font-family: ${siteFontStack(site.siteFont)}; }`;
      stage.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>${page}</style><style>${o.useLook ? look : ""}</style></head><body>${c.replace("</script>", "<\/script>")}</body></html>`;
    }, 200);
  }
  form.addEventListener("input", ev => {
    const t = ev.target;
    if (t.dataset.filter !== undefined) o.filters[t.dataset.filter] = t.value;
    else if (t.dataset.o) o[t.dataset.o] = t.type === "checkbox" ? t.checked : t.value;
    else return;
    // Changing what's shown changes which controls make sense.
    update({ redraw: ["show", "menu"].includes(t.dataset.o) });
  });
  $("#copycode").onclick = () => copy($("#code").value, "embed code copied");
  update({ redraw: true });
}

// ---- style playground ----
// Try out looks on your own posts, then copy the CSS into your site. Edits are a draft (kept in this
// browser) until "save look": the saved look is what your page here and the front page show your
// posts in, and what other blogs can start from. Your own site only changes when you paste the CSS.

// Your saved look, or the archizzl default if you haven't made one.
const myLook = () => (me.look && Object.keys(me.look).length ? { ...me.look } : { ...DEFAULT_LOOK });
const DRAFT_KEY = `kmp-look-draft-${username}`;
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { return null; }
}
function setDraft(look) {
  try { look ? localStorage.setItem(DRAFT_KEY, JSON.stringify(look)) : localStorage.removeItem(DRAFT_KEY); } catch {}
}
const sameLook = (a, b) => JSON.stringify(Object.entries(a).filter(([, v]) => v).sort()) === JSON.stringify(Object.entries(b).filter(([, v]) => v).sort());

async function styleView() {
  const draft = loadDraft();
  let s = draft || myLook();
  const [{ posts }, { files }, { looks }] = await Promise.all([api("posts"), api("files"), api("looks")]);
  const published = posts.filter(p => p.published);
  const photo = files.find(f => f.content_type.startsWith("image/"));
  const tagsField = (me.fields || []).find(d => d.kind === "tags");

  // What the preview shows: checkboxes, remembered for next time in this browser.
  const SHOW_KEY = `kmp-style-preview-${username}`;
  let show = { list: true, menu: Boolean(tagsField), post: false, photo: false };
  try { Object.assign(show, JSON.parse(localStorage.getItem(SHOW_KEY)) || {}); } catch {}

  const control = c => {
    const v = s[c.key] ?? c.def ?? "";
    if (c.type === "select") {
      return `<label>${esc(c.label)} <select data-key="${c.key}">${Object.entries(c.options)
        .map(([val, label]) => `<option value="${esc(val)}"${val === v ? " selected" : ""}>${esc(label)}</option>`)
        .join("")}</select></label>`;
    }
    // Colours can be left unset ("your site decides").
    const on = Boolean(v);
    return `<label class="colour">${esc(c.label)}
      <span><input type="checkbox" data-on="${c.key}"${on ? " checked" : ""} aria-label="set ${esc(c.label)}">
      <input type="color" data-key="${c.key}" value="${esc(v || c.def || "#333333")}"${on || c.def ? "" : " disabled"}></span></label>`;
  };
  const groups = [...new Set(CONTROLS.map(c => c.group))];
  const box = (key, label, disabled) =>
    `<label class="check"><input type="checkbox" data-show="${key}"${show[key] && !disabled ? " checked" : ""}${disabled ? " disabled" : ""}> ${label}</label>`;

  frame(
    "style",
    `<p>try out how your posts could look on your own site. the preview uses your real posts. when you like it, copy the css at the bottom into your site.</p>
    <div class="playground">
      <form class="style-controls" id="controls" autocomplete="off">
        <div class="savebar"><span id="lookstatus"></span>
          <button type="button" class="primary" id="savelook">save look</button>
          <button type="button" id="discard">discard changes</button></div>
        <label>start from <select id="preset">
          <option value="">choose…</option>
          <option value="default">the default (archizzl style)</option>
          ${looks.map((l, i) => `<option value="${i}">${esc(l.name)}'s look</option>`).join("")}
        </select></label>
        ${looks.length ? "" : `<p class="muted" style="font-size:14px;margin:0">other blogs' looks show up here once they make one.</p>`}
        ${groups.map(g => `<fieldset><legend>${esc(g)}</legend>${CONTROLS.filter(c => c.group === g).map(control).join("")}</fieldset>`).join("")}
        <fieldset class="site"><legend>your site (preview only)</legend>
          <p class="muted">roughly what your page looks like around the posts. this isn't in the css.</p>
          ${SITE_CONTROLS.map(control).join("")}
        </fieldset>
      </form>
      <div class="style-preview">
        <fieldset class="showwhat"><legend>preview</legend>
          ${box("list", "my latest posts", !published.length)}
          ${tagsField ? box("menu", `${esc(tagsField.name)} buttons above them`, !published.length) : ""}
          ${box("post", published.length ? `one post on its own (“${esc(published[0].title)}”)` : "one post on its own", !published.length)}
          ${box("photo", "a photo", !photo)}
        </fieldset>
        <iframe id="stage" title="preview of your posts on your site"></iframe>
        ${published.length ? "" : `<p class="muted">publish a post to see it here.</p>`}
      </div>
    </div>
    <h2>your css</h2>
    <p class="muted">paste this into your site's stylesheet, or inside <code>&lt;style&gt;…&lt;/style&gt;</code> in your page's <code>&lt;head&gt;</code>. it works with every embed code from this dashboard, and your site's own styles fill in anything you didn't set.${s.font === "atkinson" || s.font === "archizzl" ? ` Atkinson Hyperlegible is a web font: if your site doesn't have Calibri or Atkinson, also add <code>&lt;link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible&amp;display=swap"&gt;</code>.` : ""}</p>
    <textarea id="css" class="cssout" readonly></textarea>
    <div class="toolbar"><button class="primary" id="copycss">copy css</button><button id="resetstyle">back to the default</button></div>
    <p class="muted" style="font-size:15px">saved looks also style your posts on <a href="/${esc(username)}" target="_blank">your page here</a> and on the front page.</p>`
  );
  app.onclick = null;

  const stage = $("#stage");
  const cssBox = $("#css");

  // The preview is its own little page, so the dashboard's styles don't leak in.
  function stageDoc() {
    const tag = attrs => `<script src="${origin}/embed.js" data-user="${username}" ${attrs} async><\/script>`;
    const parts = [];
    if (show.list && published.length) parts.push(tag(`data-list="3"${show.menu && tagsField ? ` data-menu="${esc(tagsField.key)}"` : ""}`));
    if (show.post && published.length) parts.push(tag(`data-post="${esc(published[0].slug)}"`));
    if (show.photo && photo) parts.push(tag(`data-image="${esc(photo.name)}"`));
    const body = parts.length ? parts.join('<hr class="kmp-preview-gap">') : `<p style="opacity:.6">tick something to preview.</p>`;
    return `<!doctype html><html><head><meta charset="utf-8"><style id="site"></style><style>.kmp-preview-gap{border:0;margin:3em 0}</style><style id="play"></style></head><body>${body}</body></html>`;
  }

  function apply() {
    const css = cssFrom(s);
    cssBox.value = css || "/* nothing changed yet: your site's own styles are used */";
    const doc = stage.contentDocument;
    if (!doc || !doc.getElementById("play")) return;
    doc.getElementById("play").textContent = css;
    doc.getElementById("site").textContent =
      `body { margin: 0; padding: 24px; background: ${s.siteBg || "#ffffff"}; color: ${s.siteText || "#000000"}; font-family: ${siteFontStack(s.siteFont)}; }`;
  }

  function load() {
    stage.onload = apply;
    stage.srcdoc = stageDoc();
  }
  load();
  apply();

  const controls = $("#controls");
  controls.addEventListener("input", ev => {
    const t = ev.target;
    if (t.id === "preset") return;
    if (t.dataset.on) {
      const colour = controls.querySelector(`input[type=color][data-key="${t.dataset.on}"]`);
      colour.disabled = !t.checked;
      s[t.dataset.on] = t.checked ? colour.value : "";
    } else if (t.dataset.key) {
      if (t.type === "color" && t.disabled) return;
      s[t.dataset.key] = t.value;
    } else return;
    apply();
    setDraft(s);
    status();
  });
  $("#preset").onchange = ev => {
    const v = ev.target.value;
    const from = v === "default" ? DEFAULT_LOOK : looks[Number(v)]?.look;
    if (!from) return;
    if (dirty() && !confirm(`Start from ${v === "default" ? "the default look" : `${looks[Number(v)].name}'s look`}? Your unsaved changes will be replaced.`)) {
      ev.target.value = "";
      return;
    }
    setDraft({ ...s, ...Object.fromEntries(Object.keys(s).map(k => [k, ""])), ...from }); // a draft until saved
    styleView();
  };
  $(".showwhat").addEventListener("change", ev => {
    const k = ev.target.dataset.show;
    if (!k) return;
    show[k] = ev.target.checked;
    try { localStorage.setItem(SHOW_KEY, JSON.stringify(show)); } catch {}
    load();
  });
  $("#copycss").onclick = () => copy(cssBox.value, "css copied");
  $("#resetstyle").onclick = () => {
    setDraft({ ...DEFAULT_LOOK });
    styleView();
  };

  // Saved or not: the status line, and which buttons make sense.
  const dirty = () => !sameLook(s, myLook());
  function status() {
    const d = dirty();
    $("#lookstatus").textContent = d ? "unsaved changes" : me.look ? "saved" : "the default (not saved yet)";
    $("#lookstatus").className = d ? "problem" : "muted";
    $("#discard").hidden = !d;
    $("#savelook").disabled = !d && Boolean(me.look);
  }
  $("#savelook").onclick = async () => {
    try {
      me.look = (await api("look", { method: "PUT", body: { look: s } })).look;
      setDraft(null);
      status();
      toast("look saved. your page here and the front page show it within a minute.");
    } catch (err) { toast(err.message, true); }
  };
  $("#discard").onclick = () => {
    if (!confirm("Discard your unsaved changes?")) return;
    setDraft(null);
    styleView();
  };
  status();
}

// ---- agent keys ----

async function agentKeys() {
  const box = $("#keys");
  const draw = async () => {
    const { keys } = await api("keys");
    box.innerHTML = keys.length
      ? `<ul class="list">${keys
          .map(
            k => `<li><div class="grow">${esc(k.label || "agent key")}<div class="muted">made ${esc(k.created_at.slice(0, 10))} · ${k.last_used_at ? `last used ${esc(k.last_used_at.slice(0, 10))}` : "not used yet"}</div></div>
              <button class="danger" data-revoke="${k.id}">revoke</button></li>`
          )
          .join("")}</ul>`
      : "";
  };
  await draw();
  box.onclick = async ev => {
    const id = ev.target.dataset.revoke;
    if (!id || !confirm("Revoke this key? Anything using it stops working straight away.")) return;
    try { await api(`keys/${id}`, { method: "DELETE" }); toast("revoked"); draw(); } catch (err) { toast(err.message, true); }
  };
  $("#newkey").onsubmit = async ev => {
    ev.preventDefault();
    try {
      const { key } = await api("keys", { method: "POST", body: { label: ev.target.label.value } });
      ev.target.reset();
      draw();
      const prompt = `Please set up my blog on ${origin} so it matches my existing blog at <link to your old blog>.
Read the guide first: ${origin}/agents.md
My username is ${username} and my agent key is ${key}
Ask me before publishing anything or changing my own site.`;
      showSnippet("your agent key", [
        { label: "give your AI assistant this message", code: prompt, note: "fill in the link to your old blog. the key is only shown now: if you lose it, make a new one." },
        { label: "just the key", code: key },
      ], `<p class="muted">anyone with the key can write, publish and delete posts and files as you, so treat it like a password. revoke it below when the agent's done.</p>`);
    } catch (err) { toast(err.message, true); }
  };
}

// ---- photos ----

// Phone photos are big and carry GPS location. Redrawing them on a canvas makes them smaller
// and drops that hidden information. GIFs are left alone so animations keep working.
async function shrink(file) {
  const type = file.type.toLowerCase();
  const heic = /heic|heif/.test(type) || /\.(heic|heif)$/i.test(file.name);
  if (!/^image\/(jpeg|png|webp)$/.test(type) && !heic) return { blob: file, name: file.name };
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    if (heic) throw new Error("This browser can't open HEIC photos. Export it as a JPEG first (or upload from your phone).");
    return { blob: file, name: file.name };
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  // PNG and WebP only get redrawn when they're too big (to keep transparency); JPEGs always, to drop location data.
  if (scale === 1 && !heic && type !== "image/jpeg") return { blob: file, name: file.name, width: bmp.width, height: bmp.height };
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  const outType = type === "image/png" ? "image/png" : type === "image/webp" ? "image/webp" : "image/jpeg";
  const blob = await new Promise(r => canvas.toBlob(r, outType, 0.85));
  if (!blob || blob.type !== outType) return { blob: file, name: file.name, width: bmp.width, height: bmp.height };
  const ext = { "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg" }[outType];
  return { blob, name: file.name.replace(/\.[^.]+$/, "") + "." + ext, width: w, height: h };
}

async function uploadFile(file) {
  const s = await shrink(file);
  const type = s.blob.type || "application/octet-stream";
  const headers = { "content-type": type };
  if (s.width) { headers["x-width"] = String(s.width); headers["x-height"] = String(s.height); }
  return (await api(`files?name=${encodeURIComponent(s.name)}`, { method: "PUT", body: s.blob, headers })).file;
}

// ---- files ----

async function filesView() {
  const { files } = await api("files");
  const items = files
    .map(f => {
      const img = f.content_type.startsWith("image/");
      return `<li>
        ${img ? `<img class="thumb" src="${esc(f.url)}" alt="" loading="lazy">` : `<div class="thumb doc">${esc(f.name.split(".").pop())}</div>`}
        <div class="grow"><a class="filename" href="${esc(f.url)}" target="_blank">${esc(f.name)}</a>
          <div class="muted">${kb(f.size)}${f.width ? ` · ${f.width}×${f.height}` : ""}</div>
          ${img ? `<div class="muted">${f.alt ? `alt: ${esc(f.alt)}` : `<span class="problem">no description yet</span>`}${f.caption ? `<br>caption: ${esc(f.caption)}` : ""}</div>` : ""}</div>
        <div class="buttons">
          ${img ? `<button data-describe="${f.id}">describe</button><button data-embed="${f.id}">embed code</button>` : ""}
          <button data-copy="${f.id}">copy link</button>
          <button class="danger" data-del="${f.id}">delete</button>
        </div></li>`;
    })
    .join("");
  frame(
    "files",
    `<div class="drop" id="drop">drop photos or files here, or <button id="pick">choose files</button>
       <input id="filepick" type="file" multiple hidden>
       <p class="muted">photos, PDFs and .md/.txt files, up to 25 MB. big photos are shrunk and their location data is removed.</p></div>
     <p><button id="import">turn a .md or .txt file into a post</button><input id="importfile" type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" hidden></p>
     <p class="muted">your files are public at <code>${esc(me.cdn)}</code></p>
     ${files.length ? `<ul class="list">${items}</ul>` : "<p>no files yet.</p>"}`
  );

  const drop = $("#drop");
  const send = async list => {
    let done = 0;
    for (const file of list) {
      toast(`uploading ${file.name}…`);
      try { await uploadFile(file); done++; } catch (err) { toast(`${file.name}: ${err.message}`, true); await new Promise(r => setTimeout(r, 1500)); }
    }
    if (done) { toast(`uploaded ${done} file${done === 1 ? "" : "s"}`); filesView(); }
  };
  $("#pick").onclick = () => $("#filepick").click();
  $("#filepick").onchange = ev => send([...ev.target.files]);
  drop.ondragover = ev => { ev.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = ev => { ev.preventDefault(); drop.classList.remove("over"); send([...ev.dataTransfer.files]); };

  $("#import").onclick = () => $("#importfile").click();
  $("#importfile").onchange = async ev => {
    const file = ev.target.files[0];
    if (!file) return;
    const text = (await file.text()).replace(/\r\n/g, "\n");
    const m = text.match(/^\s*#\s+(.+)\n+/);
    const title = m ? m[1].trim() : file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    try {
      const { post } = await api("posts", { method: "POST", body: { title, body: m ? text.slice(m[0].length) : text, published: 0 } });
      toast("imported as a draft");
      location.hash = `#edit/${post.id}`;
    } catch (err) { toast(err.message, true); }
  };

  app.onclick = async ev => {
    const t = ev.target;
    const f = files.find(x => x.id == (t.dataset.copy || t.dataset.embed || t.dataset.describe || t.dataset.del));
    if (!f) return;
    if (t.dataset.copy) copy(f.url, "link copied");
    if (t.dataset.describe) describe(f);
    if (t.dataset.embed) {
      showSnippet(`embed ${f.name}`, [
        {
          label: "embed (recommended)",
          code: imageSnippet(f),
          note: "shows the photo with its description and caption. change those here and every page updates.",
        },
        { label: "plain image", code: imgTag(f), note: "for sites that don't allow &lt;script&gt; tags. the description is copied in now and won't update." },
      ]);
    }
    if (t.dataset.del) {
      if (!confirm(`Delete ${f.name}? Any page or post that shows it will have a broken image. Copies cached around the web can take a little while to disappear.`)) return;
      try { await api(`files/${f.id}`, { method: "DELETE" }); toast("deleted"); filesView(); } catch (err) { toast(err.message, true); }
    }
  };
}

// Alt text (read aloud to people who can't see the photo) and an optional caption.
function describe(f) {
  const d = document.createElement("dialog");
  d.innerHTML = `<h2>describe ${esc(f.name)}</h2>
    <img src="${esc(f.url)}" alt="" style="max-width:100%;max-height:220px;display:block;margin-bottom:10px">
    <form method="dialog" class="stack">
      <label>description <span class="muted">(alt text: what's in the photo, for people who can't see it)</span>
        <input name="alt" value="${esc(f.alt || "")}" placeholder="my dog asleep on a beach towel"></label>
      <label>caption <span class="muted">(optional, shown under the photo. **bold**, *italics* and [links](https://…) work)</span>
        <input name="caption" value="${esc(f.caption || "")}"></label>
      <div class="toolbar"><button class="primary" value="save">save</button><button value="cancel" formnovalidate>cancel</button></div>
    </form>`;
  d.addEventListener("close", async () => {
    const form = d.querySelector("form");
    const save = d.returnValue === "save";
    const body = { alt: form.alt.value, caption: form.caption.value };
    d.remove();
    if (!save) return;
    try { await api(`files/${f.id}`, { method: "PUT", body }); toast("saved. embeds update within a minute."); filesView(); } catch (err) { toast(err.message, true); }
  });
  document.body.append(d);
  d.showModal();
}

// ---- settings ----

// The blog's preview site (<name>.kylemaclachlanphotography.org): pick its address, turn it on and off.
function previewSite() {
  const box = $("#preview");
  const bare = u => String(u || "").replace(/^https?:\/\//, "");
  const addressForm = label => `<form id="previewname" class="row" style="max-width:640px">
      <label>address <span class="addr"><input name="name" value="${esc(me.previewName)}" autocapitalize="none" spellcheck="false" maxlength="63" required><span class="muted">${esc(me.previewDomain)}</span></span></label>
      <button type="submit">${label}</button>
    </form>`;
  box.innerHTML = me.preview
    ? `<p>your blog is up as its own website at <a href="${esc(me.preview)}" target="_blank" rel="noopener">${esc(bare(me.preview))}</a> ↗, in the look you saved in the <a href="#style">style</a> tab. search engines don't list it.</p>
      ${addressForm("change address")}
      <p class="muted">if you change the address, the old one stops working.</p>
      <button type="button" data-off>turn off preview site</button>`
    : `<p>try your blog out as its own website before you buy a domain. it shows your posts and photos in the look you saved in the <a href="#style">style</a> tab. pick its address:</p>
      ${addressForm("turn on preview site")}
      <p class="muted">letters, numbers and hyphens. search engines won't list it.</p>`;
  const send = async (body, button, done) => {
    button.disabled = true;
    try {
      Object.assign(me, await api("preview", { method: "PUT", body }));
      toast(done);
      settingsView();
    } catch (err) { toast(err.message, true); button.disabled = false; }
  };
  box.querySelector("#previewname").onsubmit = ev => {
    ev.preventDefault();
    const name = new FormData(ev.target).get("name");
    if (me.preview && name.trim().toLowerCase() === me.previewName) return toast("that's already its address");
    send({ on: true, name }, ev.target.querySelector("button"), me.preview ? "address changed" : "preview site is on");
  };
  const off = box.querySelector("[data-off]");
  if (off) off.onclick = () => send({ on: false }, off, "preview site is off");
}

function settingsView() {
  frame(
    "settings",
    `<h2>about you</h2>
    <form id="about" class="stack">
      <label>blog name <span class="muted">(shown in the sidebar on the front page and as your feed's title)</span> <input name="display_name" value="${esc(me.display_name)}" placeholder="${esc(username)}"></label>
      <label>your site <input name="site_url" value="${esc(me.site_url)}" placeholder="https://you.neocities.org"></label>
      <label>post address pattern <span class="muted">(optional) where each post lives on your site, for feed links. include {slug}.</span>
        <input name="post_url_pattern" value="${esc(me.post_url_pattern)}" placeholder="https://you.neocities.org/blog/{slug}"></label>
      <button type="submit">save</button>
    </form>

    <h2>preview site</h2>
    <div id="preview"></div>

    <h2>what your blog costs</h2>
    <div id="costs"><p class="muted">adding it up…</p></div>

    <h2>post fields</h2>
    <p class="muted">your own tags and details for posts, like an emotion, a number, or where you wrote it. they show up in the post editor.</p>
    <div id="fields"></div>
    <p class="muted" style="font-size:15px">renaming a tag doesn't rename it on posts that already have it.</p>

    <h2>embedding and styling</h2>
    <p>make the code for your site in the <a href="#embed">embed</a> tab: pick what to show, see it, copy it. try out looks for it in the <a href="#style">style</a> tab.</p>
    <p>feeds for readers: <a href="${esc(me.feeds.rss)}" target="_blank">rss</a> · <a href="${esc(me.feeds.json)}" target="_blank">json feed</a></p>

    <h2>let an AI agent set up your blog</h2>
    <p>an AI assistant (like Claude) can move your posts over from another blog, set up your tags, and write the code and styling for your own site. make it an agent key, then give it the key and a link to your old blog.</p>
    <form id="newkey" class="row" style="max-width:560px">
      <label>what's it for? <input name="label" placeholder="moving my squarespace posts" maxlength="60"></label>
      <button type="submit">make an agent key</button>
    </form>
    <div id="keys"></div>

    <h2>change your password</h2>
    <form id="pw" class="stack" style="max-width:420px">
      <input type="text" name="username" value="${esc(username)}" autocomplete="username" hidden>
      <label>current password <input name="current" type="password" autocomplete="current-password" required></label>
      <label>new password <input name="next" type="password" autocomplete="new-password" minlength="8" required></label>
      <button type="submit">change password</button>
      <p class="muted">this logs you out on your other devices.</p>
    </form>`
  );
  app.onclick = null;
  fieldsEditor();
  agentKeys();
  costs();
  previewSite();
  $("#about").onsubmit = async ev => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.target));
    try { Object.assign(me, await api("me", { method: "PUT", body })); toast("saved"); settingsView(); } catch (err) { toast(err.message, true); }
  };
  $("#pw").onsubmit = async ev => {
    ev.preventDefault();
    const { current, next } = Object.fromEntries(new FormData(ev.target));
    try { await api("password", { method: "POST", body: { current, next } }); ev.target.reset(); toast("password changed"); } catch (err) { toast(err.message, true); }
  };
}

render();
