// Post fields each friend designs for their own blog, e.g.
//   emotion  (tags: tender, restless, hopeful…)   number (auto-counting)   location (text)
//
// A definition: { key, name, kind: "tags" | "number" | "text", choices?: [..], open?: bool, hidden?: [..], auto?: bool }
//   key     the stable name used in embed codes (data-group="emotion") and stored values; set when
//           the field is made, from its name, and never changed after (renaming only changes `name`)
//   choices tags only: the allowed tags, in the order menus and groups show them
//   open    tags only: any new tag can be typed while writing; it's added to `choices` when saved
//   hidden  tags only: some of `choices`. Posts with one of these tags are left out of every list of
//           posts (the front page, the blog's page and preview site, posts.json, feeds, embeds)
//           unless the list asks for that tag (?tag=secret, ?filter=tags:secret). Each post's own
//           page still works. It's a way to keep a series out of the way, not to make it private.
//   auto    number only: new posts get the next number automatically
//
// A post's values: { [key]: ["tender", "hopeful"] | 12 | "the 14 bus stop" }

export const KINDS = ["tags", "number", "text"];
// No caps on how many fields, tags or tags per post. The only limits are lengths that keep one
// value on one line: a name or tag up to 100 characters, a text value up to 2,000.
const NAME_MAX = 100;
const TEXT_MAX = 2000;
const RESERVED = new Set(["date", "title", "slug", "id", "body", "html", "url"]);

const oneLine = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function fieldKey(name) {
  const k = oneLine(name, 60)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
  return k || "field";
}

export function parseJson(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

// Returns [definitions, problem]. `previous` keeps existing keys stable when fields are renamed.
export function cleanFieldDefs(input, previous = []) {
  if (!Array.isArray(input)) return [null, "Something was wrong with the fields. Reload and try again."];
  const known = new Set(previous.map(f => f.key));
  const used = new Set();
  const out = [];
  for (const raw of input) {
    const name = oneLine(raw?.name, NAME_MAX);
    if (!name) return [null, "Every field needs a name."];
    const kind = KINDS.includes(raw?.kind) ? raw.kind : null;
    if (!kind) return [null, `Pick what kind of field "${name}" is.`];

    // Existing fields keep their key; new ones get one from their name.
    let key = known.has(raw?.key) ? raw.key : fieldKey(name);
    if (!known.has(raw?.key) && RESERVED.has(key)) key += "_field";
    for (let n = 2; used.has(key); n++) key = `${fieldKey(name).slice(0, 27)}_${n}`;
    used.add(key);

    const def = { key, name, kind };
    if (kind === "tags") {
      const choices = [];
      for (const c of Array.isArray(raw.choices) ? raw.choices : String(raw.choices || "").split(",")) {
        const t = oneLine(c, NAME_MAX);
        if (t && !choices.some(x => x.toLowerCase() === t.toLowerCase())) choices.push(t);
      }
      const open = Boolean(raw.open);
      if (!choices.length && !open) return [null, `Give "${name}" at least one tag to choose from, or let new tags be typed while writing.`];
      def.choices = choices;
      if (open) def.open = true;
      // Hidden tags must be among the choices; they take the choice's spelling.
      const hidden = [];
      for (const h of Array.isArray(raw.hidden) ? raw.hidden : []) {
        const c = choices.find(x => x.toLowerCase() === oneLine(h, NAME_MAX).toLowerCase());
        if (c && !hidden.includes(c)) hidden.push(c);
      }
      if (hidden.length) def.hidden = hidden;
    }
    if (kind === "number") def.auto = Boolean(raw.auto);
    out.push(def);
  }
  return [out, null];
}

// A post's values, keeping only what fits this blog's fields. Empty values are left out.
export function cleanPostFields(defs, input) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  for (const d of defs) {
    const v = src[d.key];
    if (d.kind === "tags") {
      const picked = (Array.isArray(v) ? v : String(v ?? "").split(",")).map(x => oneLine(x, NAME_MAX)).filter(Boolean);
      let valid;
      if (d.open) {
        // Any tag goes; a known one keeps its usual spelling. Order is as typed.
        valid = [];
        for (const p of picked) {
          const known = d.choices.find(c => c.toLowerCase() === p.toLowerCase());
          const tag = known || p;
          if (!valid.some(x => x.toLowerCase() === tag.toLowerCase())) valid.push(tag);
        }
      } else {
        valid = d.choices.filter(c => picked.some(p => p.toLowerCase() === c.toLowerCase()));
      }
      if (valid.length) out[d.key] = valid;
    } else if (d.kind === "number") {
      const n = typeof v === "number" ? v : v === "" || v == null ? NaN : Number(v);
      if (Number.isFinite(n) && Math.abs(n) < 1e12) out[d.key] = n;
    } else {
      const t = oneLine(v, TEXT_MAX);
      if (t) out[d.key] = t;
    }
  }
  return out;
}

// Public-facing values: only fields that still exist, in the blog's own order.
export function publicFields(defs, values) {
  const out = {};
  for (const d of defs) if (values[d.key] !== undefined) out[d.key] = values[d.key];
  return out;
}

// Turns ?filter=emotion:tender&sort=-number into safe SQL pieces for posts p.
// Unknown fields are ignored. Keys are [a-z0-9_] by construction, so they're safe in a JSON path.
export function listQuery(defs, params) {
  const byKey = Object.fromEntries(defs.map(d => [d.key, d]));
  const where = [];
  const binds = [];
  // Cloudflare's database takes at most 100 values per query; a few go to the user and paging.
  for (const f of params.getAll("filter").slice(0, 90)) {
    const i = f.indexOf(":");
    const d = byKey[f.slice(0, i)];
    if (i < 1 || !d) continue;
    const value = f.slice(i + 1);
    if (d.kind === "number") {
      if (!Number.isFinite(Number(value)) || value === "") continue;
      where.push(`json_extract(p.fields_json, '$.${d.key}') = ?`);
      binds.push(Number(value));
    } else {
      // Tags are arrays and text is a string; json_each handles both. Matching ignores case.
      where.push(`EXISTS (SELECT 1 FROM json_each(p.fields_json, '$.${d.key}') j WHERE lower(j.value) = lower(?))`);
      binds.push(value);
    }
  }
  const sort = String(params.get("sort") || "");
  const desc = sort.startsWith("-");
  const sk = sort.replace(/^-/, "");
  let order = "p.date DESC, p.id DESC";
  if (sk === "date") order = `p.date ${desc ? "DESC" : "ASC"}, p.id ${desc ? "DESC" : "ASC"}`;
  else if (byKey[sk] && byKey[sk].kind !== "tags") {
    const ex = `json_extract(p.fields_json, '$.${sk}')`;
    order = `(${ex} IS NULL), ${ex} ${desc ? "DESC" : "ASC"}, p.date DESC, p.id DESC`;
  }
  // Hidden tags this list asks for: posts with them are shown (see hiddenClause). Only real hidden
  // tags count, so this rarely adds more than one value to the query.
  const revealed = [];
  for (const f of params.getAll("filter").slice(0, 90)) {
    const d = byKey[f.slice(0, f.indexOf(":"))];
    const v = f.slice(f.indexOf(":") + 1).toLowerCase();
    if (d?.hidden?.some(h => h.toLowerCase() === v) && !revealed.includes(v)) revealed.push(v);
  }
  return { where: where.length ? ` AND ${where.join(" AND ")}` : "", binds, order, revealed };
}

// SQL that leaves out posts p with one of their blog's hidden tags, unless the list asks for that
// tag. `reveal` is SQL for the values asked for, like ["?5"] or ["?", "?"] (empty for none).
export function hiddenClause(reveal = []) {
  return ` AND NOT EXISTS (
    SELECT 1 FROM users hu, json_each(hu.fields_json) hd, json_each(hd.value, '$.hidden') hh,
      json_each(p.fields_json, '$.' || json_extract(hd.value, '$.key')) ht
    WHERE hu.id = p.user_id AND lower(ht.value) = lower(hh.value)${reveal.length ? ` AND lower(hh.value) NOT IN (${reveal.map(r => `lower(${r})`).join(", ")})` : ""})`;
}

// Open tag fields learn new tags: returns the definitions with any new tags added, or null if
// nothing changed.
export function growChoices(defs, values) {
  let changed = false;
  const next = defs.map(d => {
    if (d.kind !== "tags" || !d.open || !values[d.key]) return d;
    const add = values[d.key].filter(t => !d.choices.some(c => c.toLowerCase() === t.toLowerCase()));
    if (!add.length) return d;
    changed = true;
    return { ...d, choices: [...d.choices, ...add] };
  });
  return changed ? next : null;
}
