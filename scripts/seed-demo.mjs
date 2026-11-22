// Fills the LOCAL dev server with two sample blogs, for the demo sites in demo/.
//
//   npm run dev                 (in one terminal)
//   node scripts/seed-demo.mjs  (in another)
//
// It logs into /admin with ADMIN_PASSWORD from .dev.vars, creates (or resets) two friends,
// draws their photos, uploads them and writes their posts. Safe to run again: blogs that already
// have posts are left alone. Refuses to run against anything but localhost.

import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";

const BASE = process.env.BASE || "http://localhost:8127";
const DEMO = process.env.DEMO || "http://localhost:8128";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("The demo seed only runs against a local server.");

const vars = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
const ADMIN_PASSWORD = vars.match(/^ADMIN_PASSWORD="?([^"\n]+)"?/m)?.[1];
if (!ADMIN_PASSWORD) throw new Error("No ADMIN_PASSWORD in .dev.vars");

// Local-only sample accounts.
const BLOGS = [
  {
    username: "smallhours",
    password: "demo-smallhours-1",
    settings: { display_name: "small hours", site_url: `${DEMO}/poetry/`, post_url_pattern: `${DEMO}/poetry/?poem={slug}` },
    // This poet tags poems by emotion, numbers them, and notes where each was written.
    fields: [
      { name: "emotion", kind: "tags", choices: ["tender", "restless", "lonely", "hopeful", "giddy"] },
      { name: "no.", kind: "number", auto: true },
      { name: "written at", kind: "text" },
    ],
  },
  {
    username: "xenolab",
    password: "demo-xenolab-1",
    settings: { display_name: "synthetic tenderness", site_url: `${DEMO}/xeno/`, post_url_pattern: `${DEMO}/xeno/?post={slug}` },
  },
];

// ---- a tiny cookie-keeping client ----

function client() {
  const jar = new Map();
  return async (path, { method = "GET", form, json, body, headers = {} } = {}) => {
    const h = new Headers(headers);
    if (jar.size) h.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    if (path.startsWith("/api/") && method !== "GET") h.set("x-kmp", "1");
    let payload = body;
    if (form) payload = new URLSearchParams(form);
    if (json !== undefined) { payload = JSON.stringify(json); h.set("content-type", "application/json"); }
    const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  };
}

// ---- drawing: a small PNG writer, then macOS sips turns it into a JPEG ----

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x / w, y / h, x, y);
      raw[row + 1 + x * 3] = r; raw[row + 2 + x * 3] = g; raw[row + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}
const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

const tmp = mkdtempSync(join(tmpdir(), "blog-cdn-seed-"));
function jpeg(name, w, h, pixel) {
  const p = join(tmp, name.replace(/\.jpg$/, ".png"));
  writeFileSync(p, png(w, h, pixel));
  try {
    const out = join(tmp, name);
    execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "82", p, "--out", out], { stdio: "ignore" });
    return { name, type: "image/jpeg", data: readFileSync(out), w, h };
  } catch {
    return { name: name.replace(/\.jpg$/, ".png"), type: "image/png", data: readFileSync(p), w, h }; // no sips: keep the PNG
  }
}

const IMAGES = {
  smallhours: [
    {
      file: () => jpeg("moon-over-the-laundromat.jpg", 1400, 1000, (u, v) => {
        const sky = mix([255, 214, 226], [196, 220, 255], v);
        const d = Math.hypot(u - 0.68, (v - 0.3) * 0.72);
        const moon = d < 0.11 ? 1 : d < 0.13 ? 1 - (d - 0.11) / 0.02 : 0;
        const roof = v > 0.78 + 0.03 * Math.sin(u * 9) ? 1 : 0;
        const c = mix(mix(sky, [255, 250, 225], moon), [120, 110, 160], roof);
        return c.map(x => clamp(x + (hash(u * 900, v * 900) - 0.5) * 6));
      }),
      alt: "a pink and blue evening sky with a pale yellow moon over a wavy purple roofline",
      caption: "the laundromat roof, tuesday, 9:40pm",
    },
    {
      file: () => jpeg("kitchen-window.jpg", 1200, 1200, (u, v) => {
        const wall = mix([255, 241, 200], [255, 224, 170], v);
        const pane = Math.abs(u - 0.5) < 0.3 && Math.abs(v - 0.45) < 0.3;
        const bar = pane && (Math.abs(u - 0.5) < 0.012 || Math.abs(v - 0.45) < 0.012);
        const glass = mix([170, 210, 255], [230, 200, 255], u);
        const pot = Math.hypot((u - 0.5) * 1.6, v - 0.86) < 0.09 ? 1 : 0;
        const leaf = Math.hypot(u - 0.5 - 0.06 * Math.sin(v * 30), v - 0.7) < 0.07 && v < 0.8 ? 1 : 0;
        let c = pane ? (bar ? [255, 255, 255] : glass) : wall;
        c = mix(c, [210, 120, 90], pot);
        c = mix(c, [110, 180, 110], leaf * (1 - pot));
        return c;
      }),
      alt: "a cartoonish kitchen window with blue glass and a small green houseplant in a terracotta pot",
      caption: "my houseplant, *ferdinand*, keeping watch",
    },
  ],
  xenolab: [
    {
      file: () => jpeg("chrome-membrane.jpg", 1600, 1100, (u, v) => {
        const d1 = Math.hypot(u - 0.3, v - 0.4), d2 = Math.hypot(u - 0.75, v - 0.65);
        const t = Math.sin(d1 * 42) + Math.sin(d2 * 37) + Math.sin((u + v) * 9);
        return [128 + 100 * Math.sin(t * 1.3), 128 + 110 * Math.sin(t * 1.3 + 2.1), 140 + 115 * Math.sin(t * 1.3 + 4.2)].map(clamp);
      }),
      alt: "iridescent rippling chrome, banded with violet, green and silver",
      caption: "membrane study 01: **interference** as a skin",
    },
    {
      file: () => jpeg("lattice.jpg", 1600, 1100, (u, v) => {
        const wu = u + 0.03 * Math.sin(v * 14), wv = v + 0.03 * Math.sin(u * 11);
        const gx = Math.abs((wu * 24) % 1 - 0.5), gy = Math.abs((wv * 16) % 1 - 0.5);
        const line = Math.max(0, 1 - Math.min(gx, gy) * 18);
        const glow = Math.exp(-Math.hypot(u - 0.5, v - 0.5) * 3);
        return mix([10, 8, 20], [182, 255, 0], line * (0.45 + 0.55 * glow)).map(clamp);
      }),
      alt: "a warped acid-green grid glowing on a near-black background",
      caption: "lattice: the grid bends when you lean on it",
    },
    {
      file: () => jpeg("spectral-body.jpg", 1600, 1100, (u, v) => {
        let f = 0;
        for (const [cx, cy, r] of [[0.32, 0.5, 0.18], [0.55, 0.38, 0.14], [0.66, 0.62, 0.2], [0.45, 0.7, 0.1]]) f += (r * r) / ((u - cx) ** 2 + ((v - cy) * 0.75) ** 2 + 1e-4);
        const s = Math.min(1, f / 3);
        const bg = mix([20, 10, 40], [60, 20, 90], v);
        const body = mix([138, 92, 255], [182, 255, 0], 0.5 + 0.5 * Math.sin(f * 2.2));
        return mix(bg, body, s).map((x, i) => clamp(x + (hash(u * 1600, v * 1100 + i) - 0.5) * 14));
      }),
      alt: "soft glowing violet and green shapes merging into one body on a dark purple background",
      caption: "spectral body (no fixed edges)",
    },
    {
      file: () => jpeg("signal.jpg", 1600, 1100, (u, v) => {
        const band = Math.floor(v * 60);
        const shift = hash(band, 3) > 0.7 ? (hash(band, 9) - 0.5) * 0.2 : 0;
        const x = u + shift;
        const scan = 0.75 + 0.25 * Math.sin(v * 1100 * Math.PI);
        const base = mix([240, 240, 255], [138, 92, 255], x) ;
        const split = hash(band, 5) > 0.85 ? [255, 40, 120] : base;
        return split.map(c => clamp(c * scan * (0.85 + 0.15 * hash(Math.floor(x * 80), band))));
      }),
      alt: "horizontal scanlines in white and violet, some bands shifted sideways and flashing pink like a broken signal",
      caption: "signal / noise / signal",
    },
    {
      file: () => jpeg("orbit.jpg", 1600, 1100, (u, v) => {
        const a = Math.hypot(u - 0.42, (v - 0.5) * 0.7) * 160, b = Math.hypot(u - 0.58, (v - 0.5) * 0.7) * 160;
        const m = (Math.sin(a) * Math.sin(b) + 1) / 2;
        return mix([12, 12, 18], [210, 215, 230], m ** 3).map(clamp);
      }),
      alt: "black and silver concentric rings overlapping into a moire pattern",
      caption: "orbit (two centres, one surface)",
    },
  ],
};

// Writing is original sample text for the demo. Image placeholders like {{chrome-membrane.jpg}}
// are swapped for the uploaded file's URL.
const POSTS = {
  smallhours: [
    {
      title: "small hours",
      date: "2026-11-18",
      fields: { emotion: ["lonely", "tender"], no: 4, written_at: "the kitchen table, 3:12am" },
      body: `the fridge hums a song it learned from the moon
the clock forgets, then remembers, then forgets
i am awake for no reason
which is its own kind of reason

somewhere a bus is idling with its lights on
somewhere someone is also awake
we are not friends exactly
but we are keeping the same hours`,
    },
    {
      title: "inventory of the kitchen at 2am",
      date: "2026-11-12",
      fields: { emotion: ["restless", "giddy"], no: 3, written_at: "standing at the open fridge" },
      body: `one (1) lemon, optimistic
half a loaf, wearing its heel like a hat
a spoon that has seen things
the cereal, quietly judging

and me, in socks that do not match,
counting what i have
like it might add up to a plan

![a cartoonish kitchen window with blue glass and a small green houseplant in a terracotta pot]({{kitchen-window.jpg}})`,
    },
    {
      title: "the bus is late again",
      date: "2026-11-04",
      fields: { emotion: ["hopeful", "restless"], no: 2, written_at: "the 14 bus stop" },
      body: `*for everyone at the 14 stop*

the bus is late again
and we have all become philosophers
the woman with the orange scarf says *it'll come*
the way you'd say it about spring

the boy with headphones nods
as if he's heard this song before
and i check the sky for weather
and find, instead, a moon

![a pink and blue evening sky with a pale yellow moon over a wavy purple roofline]({{moon-over-the-laundromat.jpg}})`,
    },
    {
      title: "letter to my houseplant",
      date: "2026-10-27",
      fields: { emotion: ["tender", "hopeful"], no: 1, written_at: "the windowsill" },
      body: `dear ferdinand,
i am sorry about august.
i was going through something
and so, it turns out, were you.

you lean toward the window
the way i lean toward good news.
neither of us is subtle.
both of us are still here.

**love,**
the one with the watering can`,
    },
  ],
  xenolab: [
    {
      title: "notes toward a synthetic tenderness",
      date: "2026-11-20",
      body: `## 0. starting point

alienation is not the wound, it is the workshop. nobody was born into a body they *chose*; everybody is improvising with borrowed tools.

## 1. care is a technology

a pill organizer. a shared calendar. a group chat that remembers whose turn it is to check in. we pretend tenderness is the opposite of machinery, but most of the tenderness i've received arrived through a device.

> the question was never *natural or artificial?* the question is *who gets access to the tools, and who gets to rewrite them?*

## 2. what these photos are

nothing in this series was photographed. every surface was computed, pixel by pixel, from a handful of equations. i like that they look like skin anyway.

![iridescent rippling chrome, banded with violet, green and silver]({{chrome-membrane.jpg}})

*further reading: Laboria Cuboniks, "Xenofeminism: A Politics for Alienation" (2015).*`,
    },
    {
      title: "the membrane is a protocol",
      date: "2026-11-09",
      body: `a skin is an agreement about what gets in.

we talk about bodies as if they were sealed, but every surface here is porous: light, data, hormones, rumours, weather. the membrane is less a wall than a **protocol** — a set of rules that can be read, and therefore rewritten.

![a warped acid-green grid glowing on a near-black background]({{lattice.jpg}})

the grid is the same idea, slower. it looks rigid until you lean on it. then it bends where the weight is.`,
    },
    {
      title: "against the given (fragments)",
      date: "2026-10-30",
      body: `1. *given* is a strange word for things nobody asked for.
2. the default settings were written by someone. find out who.
3. open source the recipe. open source the clinic. open source the lullaby.
4. a body with no fixed edges is not broken. it is *in progress*.
5. refuse the nostalgia for a nature that never cared about you.
6. build the tool. share the tool. let someone else improve the tool.

![soft glowing violet and green shapes merging into one body on a dark purple background]({{spectral-body.jpg}})`,
    },
  ],
};

// ---- run ----

const admin = client();
let res = await admin("/admin/login", { method: "POST", form: { password: ADMIN_PASSWORD } });
if (res.status !== 303) throw new Error(`Admin login failed (${res.status}). Is the dev server running at ${BASE}?`);

for (const blog of BLOGS) {
  // Create the friend, or reset their password to the known demo one.
  res = await admin("/admin/users", { method: "POST", form: { username: blog.username, display_name: blog.settings.display_name, password: blog.password } });
  if (res.status !== 200) {
    const page = await (await admin("/admin")).text();
    const id = page.split(`<b>${blog.username}</b>`)[1]?.match(/\/admin\/users\/(\d+)\/password/)?.[1];
    if (!id) throw new Error(`Couldn't create or find ${blog.username}`);
    await admin(`/admin/users/${id}/password`, { method: "POST", form: { password: blog.password } });
    await admin(`/admin/users/${id}/disabled`, { method: "POST", form: { disabled: "0" } });
  }

  const me = client();
  res = await me("/login", { method: "POST", form: { username: blog.username, password: blog.password } });
  if (res.status !== 303) throw new Error(`Couldn't log in as ${blog.username}`);
  await me("/api/me", { method: "PUT", json: blog.settings });
  if (blog.fields) await me("/api/fields", { method: "PUT", json: { fields: blog.fields } });

  const existing = (await (await me("/api/posts")).json()).posts;
  if (existing.length) {
    // Already seeded: just bring each post's fields up to date.
    for (const sample of POSTS[blog.username]) {
      const found = existing.find(p => p.title === sample.title);
      if (!found || !sample.fields) continue;
      const { post } = await (await me(`/api/posts/${found.id}`)).json();
      await me(`/api/posts/${post.id}`, {
        method: "PUT",
        json: { title: post.title, slug: post.slug, date: post.date, body: post.body_md, published: post.published, fields: sample.fields },
      });
      console.log(`${blog.username}: updated fields on "${post.title}"`);
    }
    continue;
  }

  // Photos first, so posts can point at them.
  const urls = {};
  for (const img of IMAGES[blog.username]) {
    const f = img.file();
    const up = await me(`/api/files?name=${encodeURIComponent(f.name)}`, {
      method: "PUT",
      body: f.data,
      headers: { "content-type": f.type, "x-width": String(f.w), "x-height": String(f.h) },
    });
    const { file, error } = await up.json();
    if (error) throw new Error(`${f.name}: ${error}`);
    await me(`/api/files/${file.id}`, { method: "PUT", json: { alt: img.alt, caption: img.caption } });
    urls[f.name.replace(/\.png$/, ".jpg")] = file.url;
    console.log(`${blog.username}: uploaded ${file.name} (${Math.round(file.size / 1024)} KB)`);
  }

  // Oldest first, so the newest post is also the newest row.
  for (const post of [...POSTS[blog.username]].reverse()) {
    const body = post.body.replace(/\{\{([^}]+)\}\}/g, (_, name) => urls[name] || "");
    const r = await me("/api/posts", { method: "POST", json: { ...post, body, published: 1 } });
    if (!r.ok) throw new Error(`${post.title}: ${(await r.json()).error}`);
    console.log(`${blog.username}: published "${post.title}"`);
  }
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\ndone. front page: ${BASE}/   sample sites: ${DEMO}/poetry/ and ${DEMO}/xeno/`);
