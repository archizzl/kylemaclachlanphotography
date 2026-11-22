// Server-built pages: the two login forms, Archie's admin page, the dashboard shell and errors.

import { escapeHtml as e } from "./util.js";

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

export function loginPage({ message = "", username = "" } = {}) {
  return shell(
    "log in",
    `<main class="narrow">
<h1>log in</h1>
<p class="muted">use the username and password Archie gave you.</p>
${message ? `<p class="problem">${e(message)}</p>` : ""}
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
export function adminPage(users, note = null) {
  const rows = users
    .map(
      u => `<tr class="${u.disabled ? "off" : ""}">
  <td><b>${e(u.username)}</b>${u.display_name ? `<br><span class="muted">${e(u.display_name)}</span>` : ""}</td>
  <td>${u.published} published<br><span class="muted">${u.drafts} draft${u.drafts === 1 ? "" : "s"}</span></td>
  <td>${u.files} file${u.files === 1 ? "" : "s"}<br><span class="muted">${kb(u.bytes || 0)}</span></td>
  <td>${u.disabled ? '<span class="draft">disabled</span>' : "active"}</td>
  <td class="actions">
    <form method="post" action="/admin/users/${u.id}/password">
      <input name="password" type="text" placeholder="new password (blank = make one)" autocomplete="off" aria-label="new password for ${e(u.username)}">
      <button type="submit">reset password</button>
    </form>
    <form method="post" action="/admin/users/${u.id}/disabled">
      <input type="hidden" name="disabled" value="${u.disabled ? 0 : 1}">
      <button type="submit">${u.disabled ? "enable" : "disable"}</button>
    </form>
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

  return shell(
    "admin · friends",
    `<header class="top"><h1>friends</h1><a class="black_button" href="/admin/logout">log out</a></header>
<main>
${noteHtml}
<section>
<h2>add a friend</h2>
<form method="post" action="/admin/users" class="row">
  <label>username <input name="username" required pattern="[a-z0-9][a-z0-9-]{0,28}[a-z0-9]" autocapitalize="none" spellcheck="false" placeholder="maya"></label>
  <label>name <input name="display_name" placeholder="Maya R."></label>
  <label>password <input name="password" type="text" autocomplete="off" placeholder="blank = make one"></label>
  <button type="submit">add</button>
</form>
<p class="muted">they log in at <a href="/login">/login</a>. their files go to <code>cdn…/username/</code>.</p>
</section>
<section>
<h2>everyone</h2>
${users.length ? `<table class="users"><thead><tr><th>who</th><th>posts</th><th>files</th><th>status</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : "<p>no one yet.</p>"}
</section>
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
