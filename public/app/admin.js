// /admin: shrinks a photo of Kyle MacLachlan before adding it to the front page's rotation.
// Without JavaScript the form still posts as it is.
import { shrink } from "./photos.js";

const form = document.getElementById("addkyle");
if (form) {
  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "adding…";
    try {
      const data = new FormData(form);
      const file = form.photo.files[0];
      if (file) {
        const s = await shrink(file, 1600);
        data.set("photo", new File([s.blob], s.name, { type: s.blob.type || file.type }));
        if (s.width) { data.set("width", s.width); data.set("height", s.height); }
      }
      const res = await fetch("/admin/kyle", { method: "POST", body: data, headers: { accept: "application/json" } });
      let r = {};
      try { r = await res.json(); } catch {}
      if (!res.ok) throw new Error(r.error || "Something went wrong. Try again.");
      if (location.pathname === "/admin") location.reload();
      else location.assign("/admin#kyle");
    } catch (err) {
      let problem = form.previousElementSibling;
      if (!problem?.classList.contains("problem")) {
        problem = document.createElement("p");
        problem.className = "problem";
        problem.setAttribute("role", "alert");
        form.before(problem);
      }
      problem.textContent = err.message;
      button.disabled = false;
      button.textContent = "add";
    }
  });
}
