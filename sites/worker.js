// Serves public/<name>/ at <name>.kylemaclachlanphotography.org (and <name>.localhost locally).
// Only the hostnames listed in wrangler.jsonc reach this Worker.

const SITE = /^([a-z0-9-]+)\.(kylemaclachlanphotography\.org|localhost)$/;

export function siteFor(hostname) {
  const m = SITE.exec(hostname.toLowerCase());
  return m && m[1] !== "www" && m[1] !== "cdn" ? m[1] : null;
}

// Asset redirects (e.g. /about -> /about/) come back with the folder in them; take it out.
export function unprefix(location, site) {
  const prefix = `/${site}`;
  try {
    const u = new URL(location, "http://x");
    if (u.pathname === prefix || u.pathname.startsWith(prefix + "/")) {
      return (u.pathname.slice(prefix.length) || "/") + u.search + u.hash;
    }
  } catch {}
  return location;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const site = siteFor(url.hostname);
    if (!site) return new Response("not found", { status: 404 });

    const inner = new URL(`/${site}${url.pathname}`, url);
    inner.search = url.search;
    const res = await env.ASSETS.fetch(new Request(inner, request));

    const out = new Response(res.body, res);
    const loc = out.headers.get("location");
    if (loc) out.headers.set("location", unprefix(loc, site));
    // Test sites stay out of search results until they move to their own domain.
    out.headers.set("x-robots-tag", "noindex");
    if (res.status === 404 && !(res.headers.get("content-type") || "").includes("html")) {
      return new Response("not found", { status: 404, headers: out.headers });
    }
    return out;
  },
};
