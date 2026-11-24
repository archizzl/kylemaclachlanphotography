// Server-built pages: the two login forms, sign-up, Archie's admin page, the dashboard shell and errors.

import { escapeHtml as e, money } from "./util.js";

function shell(title, body, { bodyClass = "", scripts = "" } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${e(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap">
<link rel="stylesheet" href="/app/app.css">
</head>
<body class="${bodyClass}">
${body}
${scripts}
</body>
</html>`;
}

export function simplePage(title, message) {
  return shell(title, `<main class="narrow"><h1>${e(title)}</h1><p>${message}</p><p><a href="/">home</a></p></main>`);
}

// /signup: works without JavaScript; signup.js shrinks the photo first when it can.
export function signupPage({ message = "", firstName = "", blogName = "" } = {}) {
  return shell(
    "sign up",
    `<main class="narrow">
<h1>sign up</h1>
<p class="muted">kyle maclachlan photography blog cms request form</p>
<p class="problem" role="alert"${message ? "" : " hidden"}>${e(message)}</p>
<form method="post" action="/signup" enctype="multipart/form-data" class="stack" id="signup">
  <label>first name <input name="first_name" autocomplete="given-name" maxlength="60" required value="${e(firstName)}"></label>
  <label>blog name <input name="blog_name" maxlength="200" required value="${e(blogName)}" placeholder="maya's notebook"></label>
  <p class="muted" id="username-note" hidden></p>
  <label>password <span class="muted">(at least 8 characters)</span> <input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="200" required></label>
  <label>your favorite photo of kyle maclachlan <input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" required></label>
  <label class="trap" aria-hidden="true">leave this empty <input name="website" tabindex="-1" autocomplete="off"></label>
  <button type="submit">send</button>
</form>
</main>`,
    { bodyClass: "signup", scripts: `<script src="/app/signup.js" type="module"></script>` }
  );
}

export function signupThanksPage({ firstName, username }) {
  return shell(
    "thanks",
    `<main class="narrow">
<h1>thanks${firstName ? `, ${e(firstName)}` : ""}</h1>
<p>archie will look at your sign-up.${
      username
        ? ` once it's accepted, <a href="/login">log in</a> as <b>${e(username)}</b> with the password you chose. if you try before then, the login page will say it's still waiting.`
        : ""
    }</p>
<p><a href="/">front page</a></p>
</main>`
  );
}

export function loginPage({ message = "", username = "", locked = false } = {}) {
  return shell(
    "log in",
    `<main class="narrow">
<h1>log in</h1>
<p class="muted">use the username and password Archie gave you, or the ones from your sign-up. no blog yet? <a href="/signup">sign up</a>.</p>
${message ? `<p class="problem${locked ? " locked" : ""}" role="alert">${e(message)}</p>` : ""}
<form method="post" action="/login" class="stack">
  <label>username <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${e(username)}"></label>
  <label>password <input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit">log in</button>
</form>
</main>`
  );
}

export function adminLoginPage(message = "") {
  return shell(
    "admin",
    `<main class="narrow">
<h1>admin</h1>
${message ? `<p class="problem">${e(message)}</p>` : ""}
<form method="post" action="/admin/login" class="stack">
  <label>admin password <input name="password" type="password" autocomplete="current-password" required autofocus></label>
  <button type="submit">log in</button>
</form>
</main>`
  );
}

const kb = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

// users: rows with post and file counts. note: { text, password? } shown at the top after an action.
const size = b => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${Math.round(b / 1e3)} KB` : b > 0 ? "<1 KB" : "0 KB");
const monthName = (key, partial) =>
  new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) + (partial ? " (so far)" : "");

// The whole Cloudflare account's R2, from Cloudflare's own measurements where synced.
function usageSection(usage) {
  if (!usage) return "";
  const { months, sync } = usage;
  const last = sync.last;
  const status = sync.through
    ? `cloudflare's numbers are synced through <b>${e(sync.through)}</b> (kept since ${e(sync.since)}).`
    : "no numbers from cloudflare yet, so costs are estimated from the files recorded here.";
  const problem = last && !last.ok ? `<p class="problem">last sync (${e(last.at.slice(0, 16).replace("T", " "))} UTC) failed: ${e(last.error)}</p>` : "";
  const rows = months
    .filter(m => m.partial || m.gbMonths > 0 || m.classA || m.classB)
    .map(
      m => `<tr${m.source === "estimated" ? ' class="est"' : ""}>
  <td>${monthName(m.month, m.partial)}</td><td>${m.source}</td><td>${size(m.gbMonths * 1e9)}</td>
  <td>${Math.round(m.classA).toLocaleString("en-US")}</td><td>${Math.round(m.classB).toLocaleString("en-US")}</td>
  <td>${money(m.fullPrice)}</td><td><b>${money(m.charged)}</b></td></tr>`
    )
    .join("\n");
  return `<section>
<h2>cloudflare r2, whole account</h2>
<p class="muted">${status}</p>
${usage.buckets?.length ? `<p>by bucket, as of ${e(usage.buckets[0].date)}: ${usage.buckets
  .map(b => `${b.thisSite ? "<b>" : ""}${e(b.bucket)}${b.thisSite ? " (this site)</b>" : ""} ${size(b.stored_bytes)}`)
  .join(" · ")}</p>` : ""}
${problem}
<form method="post" action="/admin/sync-usage"><button type="submit">sync from cloudflare now</button></form>
${rows ? `<table class="users usage"><thead><tr><th>month</th><th>source</th><th>stored (average)</th><th>writes (class A)</th><th>reads (class B)</th><th>full price</th><th>charged</th></tr></thead><tbody>${rows}</tbody></table>` : ""}
</section>`;
}

const shortDate = iso => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");

function passwordForm(u, { label = "set password", wide = false } = {}) {
  return `<form method="post" action="/admin/users/${u.id}/password" class="pw${wide ? " wide" : ""}">
      <input name="password" type="text" placeholder="new password, or blank to make one" autocomplete="off" aria-label="new password for ${e(u.username)}">
      <button type="submit">${label}</button>
    </form>`;
}

function statusOf(u) {
  if (u.locked_at) return `<span class="draft">locked</span><br><span class="muted">since ${e(shortDate(u.locked_at))}</span>`;
  if (u.disabled) return '<span class="draft">disabled</span>';
  if (u.failed_logins) return `active<br><span class="muted">${u.failed_logins} wrong ${u.failed_logins === 1 ? "try" : "tries"}</span>`;
  return "active";
}

// The whole app's costs: every blog's storage share and domains, month by month, with a running total.
function billingSection(billing) {
  const rows = billing.months
    .filter(m => m.partial || m.total > 0 || m.fullPrice > 0)
    .map(
      m => `<tr${m.estimated ? ' class="est"' : ""}>
  <td>${monthName(m.month, m.partial)}${m.estimated ? " · est." : ""}</td><td>${money(m.storage)}</td><td>${money(m.domains)}</td>
  <td><b>${money(m.total)}</b></td><td>${money(m.cumulative)}</td><td class="muted">${money(m.fullPrice)}</td></tr>`
    )
    .join("\n");
  const t = billing.allTime;
  return `<section>
<h2>billing, whole app</h2>
${rows
  ? `<table class="users usage"><thead><tr><th>month</th><th>storage</th><th>domains</th><th>total</th><th>running total</th><th>storage at full price</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td>all time</td><td>${money(t.storage)}</td><td>${money(t.domains)}</td><td><b>${money(t.total)}</b></td><td></td><td class="muted">${money(t.fullPrice)}</td></tr></tfoot></table>`
  : "<p>nothing yet.</p>"}
</section>`;
}

// data: { users, billing, usage }. note: { text, password?, problem? } shown at the top after an action.
// Sign-up requests waiting for Archie, with their photo of Kyle MacLachlan.
function signupsSection(signups, cdnBase) {
  if (!signups.length) return "";
  return `<section class="attention">
<h2>sign-up requests</h2>
<p class="muted">accepting makes their account, with the password they chose, and adds their photo to the front page. you can change the username first. denying deletes the photo.</p>
<ul class="signups">${signups
    .map(
      s => `<li>
  <a href="${e(`${cdnBase}/${s.photo_key}`)}" target="_blank" rel="noopener"><img src="${e(`${cdnBase}/${s.photo_key}`)}" alt="${e(s.first_name)}'s photo of kyle maclachlan"></a>
  <div>
    <p><b>${e(s.first_name)}</b> wants <b>${e(s.blog_name)}</b> <span class="muted">· ${e(shortDate(s.created_at))}</span></p>
    <form method="post" action="/admin/signups/${s.id}/accept" class="row">
      <label>username <input name="username" value="${e(s.username)}" required pattern="[a-z0-9]([a-z0-9\\-]{0,28}[a-z0-9])?" autocapitalize="none" spellcheck="false"></label>
      <button type="submit" class="primary">accept</button>
    </form>
    <form method="post" action="/admin/signups/${s.id}/deny"><button type="submit" class="danger">deny</button></form>
  </div>
</li>`
    )
    .join("")}</ul>
</section>`;
}

export function adminPage({ users, billing, usage, signups = [], cdnBase = "" }, note = null) {
  const locked = users.filter(u => u.locked_at);
  const thisMonth = billing.months.find(m => m.partial);
  const rows = users
    .map(
      u => `<tr class="${u.disabled ? "off" : ""}${u.locked_at ? " is-locked" : ""}">
  <td><b>${e(u.username)}</b>${u.display_name ? `<br><span class="muted">${e(u.display_name)}</span>` : ""}</td>
  <td>${statusOf(u)}</td>
  <td>${u.published} published<br><span class="muted">${u.drafts} draft${u.drafts === 1 ? "" : "s"}</span></td>
  <td>${u.files} file${u.files === 1 ? "" : "s"}<br><span class="muted">${kb(u.bytes || 0)}</span></td>
  <td>${money(u.cost?.total)}${u.domain ? `<br><span class="muted">${e(u.domain)}</span>` : ""}</td>
  <td class="actions">
    ${passwordForm(u, { label: u.locked_at ? "set &amp; unlock" : "set password" })}
    <details>
      <form method="post" action="/admin/users/${u.id}/domain" class="domain">
        <input name="domain" value="${e(u.domain || "")}" placeholder="their-domain.com" aria-label="domain for ${e(u.username)}">
        <input name="cost" value="${u.domain_cost_cents ? (u.domain_cost_cents / 100).toFixed(2) : ""}" placeholder="$/year" aria-label="yearly cost" style="width:80px">
        <input name="since" type="date" value="${e(u.domain_since || "")}" aria-label="first paid on" style="width:140px">
        <button type="submit">save domain</button>
      </form>
      <form method="post" action="/admin/users/${u.id}/disabled">
        <input type="hidden" name="disabled" value="${u.disabled ? 0 : 1}">
        <button type="submit">${u.disabled ? "re-enable account" : "disable account"}</button>
      </form>
    </details>
  </td>
</tr>`
    )
    .join("\n");

  const noteHtml = note
    ? `<div class="note${note.problem ? " problem" : ""}"><p>${e(note.text)}</p>${
        note.password
          ? `<p>password: <code class="secret">${e(note.password)}</code> <button type="button" data-copy="${e(note.password)}">copy</button></p>
             <p class="muted">this is the only time it's shown. send it to them somewhere private.</p>`
          : ""
      }</div>`
    : "";

  const lockedHtml = locked.length
    ? `<section class="attention">
<h2>locked out</h2>
<p class="muted">three wrong passwords in a row locks an account. they're told to text you; setting a new password unlocks it.</p>
<ul class="lockedlist">${locked
        .map(
          u => `<li><b>${e(u.username)}</b>${u.display_name ? ` <span class="muted">(${e(u.display_name)})</span>` : ""} <span class="muted">locked ${e(shortDate(u.locked_at))}</span>
    ${passwordForm(u, { label: "set &amp; unlock", wide: true })}</li>`
        )
        .join("")}</ul>
</section>`
    : "";

  return shell(
    "admin",
    `<header class="top"><h1>admin</h1><a href="/" style="font-size:16px">front page</a><a class="black_button" href="/admin/logout">log out</a></header>
<main class="wide">
${noteHtml}
<dl class="stats">
  <div><dt>blogs</dt><dd>${users.filter(u => !u.disabled).length}</dd></div>
  <div><dt>whole app, all time</dt><dd>${money(billing.allTime.total)}</dd></div>
  <div><dt>this month so far</dt><dd>${money(thisMonth?.total || 0)}</dd></div>
  <div class="${locked.length ? "alert" : ""}"><dt>locked accounts</dt><dd>${locked.length}</dd></div>
  <div class="${signups.length ? "alert" : ""}"><dt>sign-up requests</dt><dd>${signups.length}</dd></div>
</dl>
${signupsSection(signups, cdnBase)}
${lockedHtml}
${billingSection(billing)}
<section>
<h2>accounts</h2>
${users.length ? `<table class="users"><thead><tr><th>blog</th><th>status</th><th>posts</th><th>files on this site</th><th>cost, all time</th><th>password and more</th></tr></thead><tbody>${rows}</tbody></table>` : "<p>no one yet.</p>"}
</section>
<section>
<h2>add a friend</h2>
<form method="post" action="/admin/users" class="row">
  <label>username <input name="username" required pattern="[a-z0-9]([a-z0-9\\-]{0,28}[a-z0-9])?" title="1–30 lowercase letters, numbers or dashes (not at the start or end)" autocapitalize="none" spellcheck="false" placeholder="maya"></label>
  <label>blog name <input name="display_name" placeholder="maya's notebook"></label>
  <label>password <input name="password" type="text" autocomplete="off" placeholder="blank = make one"></label>
  <button type="submit">add</button>
</form>
<p class="muted">usernames: 1–30 lowercase letters, numbers or dashes. they log in at <a href="/login">/login</a>. their files go to <code>cdn…/username/</code>.</p>
</section>
${usageSection(usage)}
</main>`,
    {
      bodyClass: "admin",
      scripts: `<script>document.addEventListener("click", ev => { const b = ev.target.closest("[data-copy]"); if (b) navigator.clipboard.writeText(b.dataset.copy).then(() => { b.textContent = "copied"; }); });</script>`,
    }
  );
}

// The dashboard is a small app in /app/app.js; the page just hands it who's signed in.
export function dashboardPage(user, { cdnBase, origin }) {
  const boot = JSON.stringify({ username: user.username, cdnBase, origin }).replace(/</g, "\\u003c");
  return shell("your blog", `<div id="app"></div><script>window.KMP = ${boot};</script>`, {
    bodyClass: "dash",
    scripts: `<script src="/app/app.js" type="module"></script>`,
  });
}
