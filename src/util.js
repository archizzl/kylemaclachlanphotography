// Small helpers shared by the Worker's modules.

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function html(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", ...extra },
  });
}

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

export function redirect(location, cookies = []) {
  const headers = new Headers({ location });
  for (const c of [].concat(cookies)) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export const now = () => new Date().toISOString();

// $0.00, or "<$0.01" for amounts too small to show in cents.
export function money(dollars) {
  if (!dollars) return "$0.00";
  if (dollars < 0.005) return "<$0.01";
  return `$${dollars.toFixed(2)}`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

// http(s) addresses only; anything else becomes "".
export function webUrl(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}

export function cookie(request, name) {
  const raw = (request.headers.get("cookie") || "").split(/;\s*/).find(c => c.startsWith(name + "="));
  return raw ? raw.slice(name.length + 1) : "";
}
