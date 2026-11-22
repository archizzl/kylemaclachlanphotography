// The friend dashboard: posts, files, settings. Talks to /api/* in src/worker.js.

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

const kb = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const embedOrigin = origin;

function postSnippet(post) {
  return `<script src="${embedOrigin}/embed.js" data-user="${username}" data-post="${post.slug}" async></script>
<noscript><a href="${cdnBase}/${username}/posts/${post.slug}.md">${esc(post.title)}</a></noscript>`;
}
const listSnippet = (n = 10) => `<script src="${embedOrigin}/embed.js" data-user="${username}" data-list="${n}" async></script>`;

function showSnippet(title, snippet, extra = "") {
  const d = document.createElement("dialog");
  d.innerHTML = `<h2>${esc(title)}</h2>
    <p class="muted">paste this into your page wherever the writing should show up. it updates by itself when you edit here.</p>
    <textarea readonly>${esc(snippet)}</textarea>
    ${extra}
    <div class="toolbar"><button class="primary" data-act="copy">copy</button><button data-act="close">close</button></div>`;
  d.addEventListener("click", ev => {
    const act = ev.target.dataset.act;
    if (act === "copy") copy(snippet, "embed code copied");
    if (act === "close" || ev.target === d) d.close();
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
  app.innerHTML = `<header class="top"><h1>${esc(me?.display_name || username)}'s blog</h1>
    <nav>${tab("posts", "posts")}${tab("files", "files")}${tab("settings", "settings")}<a href="/logout">log out</a></nav></header>
    <main>${inner}</main>`;
}

window.addEventListener("hashchange", () => {
  if (dirty && !confirm("You have unsaved changes. Leave without saving?")) return;
  dirty = false;
  render();
});
window.addEventListener("beforeunload", ev => { if (dirty) { ev.preventDefault(); ev.returnValue = ""; } });

async function render() {
  const [view, id] = (location.hash.slice(1) || "posts").split("/");
  try {
    if (!me) me = await api("me");
    if (view === "files") return await filesView();
    if (view === "settings") return settingsView();
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
        <div class="grow"><a href="#edit/${p.id}">${esc(p.title)}</a><time>${esc(p.date)}</time></div>
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
      <button data-act="list">embed all my posts</button></div>
    ${posts.length ? `<ul class="list">${items}</ul>` : `<p>no posts yet. <a href="#edit/new">write your first one</a>.</p>`}`
  );
  app.onclick = async ev => {
    const t = ev.target;
    if (t.dataset.act === "list") showSnippet("embed your latest posts", listSnippet(10), `<p class="muted">change <code>data-list="10"</code> to show more or fewer posts.</p>`);
    if (t.dataset.embed) showSnippet("embed this post", postSnippet(posts.find(p => p.id == t.dataset.embed)));
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
    <div class="toolbar">
      <button id="img">insert photo</button>
      <input id="imgfile" type="file" accept="image/*" hidden>
      <span style="flex:1"></span>
      <span class="status" id="status"></span>
      <button id="draft"></button>
      <button id="publish" class="primary"></button>
    </div>
    <div class="editor">
      <textarea id="body" placeholder="write here. a blank line starts a new paragraph." aria-label="post text">${esc(post.body_md)}</textarea>
      <div class="preview" id="preview" aria-live="polite"></div>
    </div>
    <p class="cheats"><code>**bold**</code> <code>*italic*</code> <code>[link text](https://…)</code> <code>## heading</code>
      <code>- list item</code> <code>&gt; quote</code> <code>![description](photo url)</code>. html is shown as plain text.</p>`
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
  body.addEventListener("input", () => { changed(); clearTimeout(previewTimer); previewTimer = setTimeout(preview, 350); });
  preview();

  async function save(published) {
    const payload = { title: title.value, slug: slug.value, date: date.value, body: body.value, published };
    status.textContent = "saving…";
    try {
      const saved = (await api(isNew && !post.id ? "posts" : `posts/${post.id}`, { method: isNew && !post.id ? "POST" : "PUT", body: payload })).post;
      const wasPublished = post.published;
      post = saved;
      dirty = false;
      slug.value = post.slug;
      slugTouched = true;
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

  $("#img").onclick = () => $("#imgfile").click();
  $("#imgfile").onchange = async ev => {
    const file = ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    status.textContent = "uploading photo…";
    try {
      const f = await uploadFile(file);
      const alt = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
      const text = `![${alt}](${f.url})`;
      const at = body.selectionStart ?? body.value.length;
      const before = body.value.slice(0, at), after = body.value.slice(at);
      const pad = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
      body.value = `${before}${pad}${text}\n\n${after}`;
      body.focus();
      changed();
      preview();
      toast("photo added. change the words in [ ] to describe it.");
    } catch (err) {
      status.textContent = "";
      toast(err.message, true);
    }
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
          <div class="muted">${kb(f.size)}${f.width ? ` · ${f.width}×${f.height}` : ""}</div></div>
        <div class="buttons">
          <button data-copy="${f.id}">copy link</button>
          ${img ? `<button data-tag="${f.id}">copy &lt;img&gt;</button>` : ""}
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
    const f = files.find(x => x.id == (t.dataset.copy || t.dataset.tag || t.dataset.del));
    if (!f) return;
    if (t.dataset.copy) copy(f.url, "link copied");
    if (t.dataset.tag) copy(`<img src="${f.url}" alt=""${f.width ? ` width="${f.width}" height="${f.height}"` : ""} style="max-width:100%;height:auto">`, "<img> tag copied");
    if (t.dataset.del) {
      if (!confirm(`Delete ${f.name}? Any page or post that shows it will have a broken image. Copies cached around the web can take a little while to disappear.`)) return;
      try { await api(`files/${f.id}`, { method: "DELETE" }); toast("deleted"); filesView(); } catch (err) { toast(err.message, true); }
    }
  };
}

// ---- settings ----

function settingsView() {
  frame(
    "settings",
    `<h2>about you</h2>
    <form id="about" class="stack">
      <label>name <input name="display_name" value="${esc(me.display_name)}" placeholder="${esc(username)}"></label>
      <label>your site <input name="site_url" value="${esc(me.site_url)}" placeholder="https://you.neocities.org"></label>
      <label>post address pattern <span class="muted">(optional) where each post lives on your site, for feed links. include {slug}.</span>
        <input name="post_url_pattern" value="${esc(me.post_url_pattern)}" placeholder="https://you.neocities.org/blog/{slug}"></label>
      <button type="submit">save</button>
    </form>

    <h2>embedding</h2>
    <p>every published post has an "embed code" button on the posts page. to show your latest posts in one go:</p>
    <p><code>${esc(listSnippet(10))}</code> <button data-act="copylist">copy</button></p>
    <p class="muted">add <code>data-style="none"</code> to use only your page's own styles, or <code>data-title="no"</code> to leave titles out.</p>
    <p>feeds for readers: <a href="${esc(me.feeds.rss)}" target="_blank">rss</a> · <a href="${esc(me.feeds.json)}" target="_blank">json feed</a></p>

    <h2>change your password</h2>
    <form id="pw" class="stack" style="max-width:420px">
      <input type="text" name="username" value="${esc(username)}" autocomplete="username" hidden>
      <label>current password <input name="current" type="password" autocomplete="current-password" required></label>
      <label>new password <input name="next" type="password" autocomplete="new-password" minlength="8" required></label>
      <button type="submit">change password</button>
      <p class="muted">this logs you out on your other devices.</p>
    </form>`
  );
  app.onclick = ev => { if (ev.target.dataset.act === "copylist") copy(listSnippet(10), "embed code copied"); };
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
