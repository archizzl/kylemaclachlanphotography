// /signup: shows the username the blog name would get, and shrinks the photo before sending it
// (which also drops a JPEG's location data). Without JavaScript the form still posts as it is.
import { shrink } from "./photos.js";

const form = document.getElementById("signup");
const problem = document.querySelector(".problem");
const note = document.getElementById("username-note");

// The same as baseUsername in src/signup.js. If it's taken, the server adds -2, -3…
const squash = s =>
  String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, 30)
    .replace(/-+$/, "");
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function showUsername() {
  const u = squash(form.blog_name.value) || squash(form.first_name.value);
  note.hidden = !u;
  note.innerHTML = u ? `you'll log in as <b>${esc(u)}</b> (or close to it, if someone has it already).` : "";
}
form.blog_name.addEventListener("input", showUsername);
form.first_name.addEventListener("input", showUsername);
showUsername();

form.addEventListener("submit", async ev => {
  ev.preventDefault();
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "sending…";
  problem.hidden = true;
  try {
    const data = new FormData(form);
    const file = form.photo.files[0];
    if (file) {
      const s = await shrink(file, 1600);
      data.set("photo", new File([s.blob], s.name, { type: s.blob.type || file.type }));
      if (s.width) { data.set("width", s.width); data.set("height", s.height); }
    }
    const res = await fetch("/signup", { method: "POST", body: data, headers: { accept: "application/json" } });
    let r = {};
    try { r = await res.json(); } catch {}
    if (!res.ok) throw new Error(r.error || "Something went wrong. Try again.");
    document.querySelector("main").innerHTML = `<h1>thanks${r.firstName ? `, ${esc(r.firstName)}` : ""}</h1>
      <p>archie will look at your sign-up.${r.username ? ` once it's accepted, <a href="/login">log in</a> as <b>${esc(r.username)}</b> with the password you chose. if you try before then, the login page will say it's still waiting.` : ""}</p>
      <p><a href="/">front page</a></p>`;
    document.title = "thanks";
  } catch (err) {
    problem.textContent = err.message;
    problem.hidden = false;
    problem.scrollIntoView({ block: "center" });
    button.disabled = false;
    button.textContent = "send";
  }
});
