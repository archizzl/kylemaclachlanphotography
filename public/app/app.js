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
const listSnippet = (n = 10) => `<script src="${embedOrigin}/embed.js" data-user="${username}" data-list="${n}" async></script>`;

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
  app.innerHTML = `<header class="top"><h1>${esc(me?.display_name || username)}</h1>
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
    ${fieldInputs(me.fields || [], post.fields || {}, isNew)}
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
  $("#postfields")?.addEventListener("input", changed);
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

// ---- post fields in the editor ----

function fieldInputs(defs, values, isNew) {
  if (!defs.length) return `<p class="muted" style="font-size:15px">want tags, numbers or a location on your posts? set them up in <a href="#settings">settings</a>.</p>`;
  return `<fieldset id="postfields" class="postfields">${defs
    .map(d => {
      const v = values[d.key];
      if (d.kind === "tags") {
        return `<div class="pf"><span class="pf-name">${esc(d.name)}</span><span class="chips">${d.choices
          .map(c => `<label><input type="checkbox" name="${esc(d.key)}" value="${esc(c)}"${(v || []).includes(c) ? " checked" : ""}>${esc(c)}</label>`)
          .join("")}</span></div>`;
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
    if (d.kind === "tags") out[d.key] = [...app.querySelectorAll(`#postfields input[name="${CSS.escape(d.key)}"]:checked`)].map(i => i.value);
    else {
      const v = document.getElementById(`field-${d.key}`)?.value ?? "";
      if (v !== "") out[d.key] = d.kind === "number" ? Number(v) : v;
    }
  }
  return out;
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
          ${d.kind === "tags" ? `<label>tags, separated by commas <input data-k="choices" value="${esc((d.choices || []).join(", "))}" placeholder="tender, restless, hopeful, giddy"></label>` : ""}
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

// Embed codes that use this blog's own fields.
function fieldExamples() {
  const tags = (me.fields || []).find(d => d.kind === "tags");
  const num = (me.fields || []).find(d => d.kind === "number");
  if (!tags && !num) return "";
  const s = attrs => `<script src="${embedOrigin}/embed.js" data-user="${username}" data-list="50" ${attrs} async></script>`;
  const ex = [];
  if (tags) {
    ex.push([`newest first, with buttons readers click to filter by ${tags.name} (the usual choice)`, s(`data-menu="${tags.key}" data-menu-label="filter by ${tags.name}"`)]);
    ex.push([`only posts tagged "${tags.choices[0]}"`, s(`data-filter="${tags.key}:${tags.choices[0]}"`)]);
  }
  if (num) ex.push([`in ${num.name} order (put a - before it for highest first)`, s(`data-sort="${num.key}"`)]);
  if (tags) ex.push([`an index page: a heading for each ${tags.name}, with its posts under it`, s(`data-group="${tags.key}"`)]);
  return `<h3 style="font-size:1em;margin:18px 0 4px">using your fields</h3>${ex
    .map(([label, code]) => `<p style="margin:10px 0 2px">${esc(label)}</p><p style="margin:0"><code>${esc(code)}</code> <button data-copycode="${esc(code)}">copy</button></p>`)
    .join("")}
    <p class="muted">you can mix these, like a menu plus number order. each post's values also show under its title (hide them with <code>data-fields="no"</code>).</p>`;
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
        m => `<tr>
          <td>${monthName(m.month, m.partial)}</td>
          <td>${size(m.gbMonths * 1e9)}</td>
          <td>${m.uploads}</td>
          <td>${money(m.fullPrice)}</td>
          <td>${money(m.storageCharged)}</td>
          ${u.domain ? `<td>${m.domain ? money(m.domain) : "–"}</td>` : ""}
          <td><b>${money(m.total)}</b></td>
        </tr>`
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
      <p class="muted" style="font-size:15px">how this is worked out: your photos, files and writing are stored with Cloudflare R2, at $${u.rates.storagePerGBMonth} per GB a month, plus $${u.rates.uploadsPerMillion} per million uploads ("full price"). every month the first ${u.rates.freeGBMonths} GB and ${(u.rates.freeUploads / 1e6).toFixed(0)} million uploads are free, shared by all of ${host}'s sites, so "storage cost" is your share of anything over that. readers viewing your posts and photos don't add to it. prices from <a href="${esc(u.rates.source)}" target="_blank" rel="noopener">cloudflare</a>, checked ${esc(u.rates.checked)}.</p>`;
  } catch (err) {
    box.innerHTML = `<p class="problem">${esc(err.message)}</p>`;
  }
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

    <h2>what your blog costs</h2>
    <div id="costs"><p class="muted">adding it up…</p></div>

    <h2>post fields</h2>
    <p class="muted">your own tags and details for posts, like an emotion, a number, or where you wrote it. they show up in the post editor.</p>
    <div id="fields"></div>
    <p class="muted" style="font-size:15px">renaming a tag doesn't rename it on posts that already have it.</p>

    <h2>embedding</h2>
    <p>every published post has an "embed code" button on the posts page. to show your latest posts in one go:</p>
    <p><code>${esc(listSnippet(10))}</code> <button data-act="copylist">copy</button></p>
    <details class="explain">
      <summary>what do the parts of an embed code mean?</summary>
      <dl>
        <dt><code>&lt;script src="…/embed.js" … async&gt;&lt;/script&gt;</code></dt><dd>the whole thing is one tag you paste into your page, where the writing should appear. the bits in the middle tell it what to show.</dd>
        <dt><code>data-user="${esc(username)}"</code></dt><dd>whose blog to show: yours. leave it as it is.</dd>
        <dt><code>data-list="10"</code></dt><dd>show a list of your newest posts, up to that many. change the number to show more or fewer (50 at most).</dd>
        <dt><code>data-post="my-post"</code></dt><dd>show just one post, by its address (the "address" box in the editor).</dd>
        <dt><code>data-image="photo.jpg"</code></dt><dd>show one photo, with its description and caption.</dd>
        <dt><code>data-menu="…"</code>, <code>data-filter="…"</code>, <code>data-sort="…"</code>, <code>data-group="…"</code></dt><dd>use your post fields: a row of filter buttons, only posts with one tag, a different order, or a heading per tag (examples below once you've set up fields).</dd>
        <dt><code>data-style="none"</code>, <code>data-title="no"</code>, <code>data-fields="no"</code></dt><dd>turn off the built-in styling, the titles and dates, or the field values.</dd>
        <dt><code>async</code></dt><dd>lets the rest of your page load without waiting for it. leave it in.</dd>
      </dl>
    </details>
    ${fieldExamples()}
    <p>photos have their own "embed code" button on the files page.</p>

    <h2>styling</h2>
    <p>embeds aren't boxed in: posts and photos go straight into your page, so they pick up your page's fonts, colors and sizes. to change how they look, add css to your own site using these classes:</p>
    <textarea readonly style="width:100%;min-height:320px">/* a post (or each post in a list) */
.kmp-post { }
.kmp-title { }          /* the post's title */
.kmp-date { }           /* the date under it */
.kmp-body { }           /* the writing itself */
.kmp-body img { }       /* photos inside posts */
.kmp-body a { }

/* a photo embed */
.kmp-image { }          /* the whole thing (a &lt;figure&gt;) */
.kmp-image img { }
.kmp-image figcaption { }</textarea>
    <p class="muted">the embed adds a few light defaults (photos fit the page, dates are a bit faded). your css always wins over them. to switch them off completely, add <code>data-style="none"</code> to the script tag. <code>data-title="no"</code> leaves post titles out and <code>data-caption="no"</code> leaves photo captions out.</p>
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
  app.onclick = ev => {
    if (ev.target.dataset.act === "copylist") copy(listSnippet(10), "embed code copied");
    if (ev.target.dataset.copycode) copy(ev.target.dataset.copycode, "embed code copied");
  };
  fieldsEditor();
  agentKeys();
  costs();
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
