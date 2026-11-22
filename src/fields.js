// Post fields each friend designs for their own blog, e.g.
//   emotion  (tags: tender, restless, hopeful…)   number (auto-counting)   location (text)
//
// A definition: { key, name, kind: "tags" | "number" | "text", choices?: [..], open?: bool, auto?: bool }
//   key     the stable name used in embed codes (data-group="emotion") and stored values; set when
//           the field is made, from its name, and never changed after (renaming only changes `name`)
//   choices tags only: the allowed tags, in the order menus and groups show them
//   open    tags only: any new tag can be typed while writing; it's added to `choices` when saved
//   auto    number only: new posts get the next number automatically
//
// A post's values: { [key]: ["tender", "hopeful"] | 12 | "the 14 bus stop" }

export const KINDS = ["tags", "number", "text"];
export const MAX_FIELDS = 10;
const MAX_CHOICES = 50;
const MAX_OPEN_CHOICES = 300; // open tag fields grow as people write
const MAX_TAGS_PER_POST = 20;
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
  if (input.length > MAX_FIELDS) return [null, `Blogs can have up to ${MAX_FIELDS} post fields.`];
  const known = new Set(previous.map(f => f.key));
  const used = new Set();
  const out = [];
  for (const raw of input) {
    const name = oneLine(raw?.name, 40);
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
        const t = oneLine(c, 40);
        if (t && !choices.some(x => x.toLowerCase() === t.toLowerCase())) choices.push(t);
      }
      const open = Boolean(raw.open);
      if (!choices.length && !open) return [null, `Give "${name}" at least one tag to choose from, or let new tags be typed while writing.`];
      const max = open ? MAX_OPEN_CHOICES : MAX_CHOICES;
      if (choices.length > max) return [null, `"${name}" can have up to ${max} tags.`];
      def.choices = choices;
      if (open) def.open = true;
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
      const picked = (Array.isArray(v) ? v : String(v ?? "").split(",")).map(x => oneLine(x, 40)).filter(Boolean);
      let valid;
      if (d.open) {
        // Any tag goes; a known one keeps its usual spelling. Order is as typed.
        valid = [];
        for (const p of picked) {
          const known = d.choices.find(c => c.toLowerCase() === p.toLowerCase());
          const tag = known || p;
          if (!valid.some(x => x.toLowerCase() === tag.toLowerCase())) valid.push(tag);
        }
        valid = valid.slice(0, MAX_TAGS_PER_POST);
      } else {
        valid = d.choices.filter(c => picked.some(p => p.toLowerCase() === c.toLowerCase()));
      }
      if (valid.length) out[d.key] = valid;
    } else if (d.kind === "number") {
      const n = typeof v === "number" ? v : v === "" || v == null ? NaN : Number(v);
      if (Number.isFinite(n) && Math.abs(n) < 1e12) out[d.key] = n;
    } else {
      const t = oneLine(v, 200);
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
  for (const f of params.getAll("filter").slice(0, 5)) {
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
  return { where: where.length ? ` AND ${where.join(" AND ")}` : "", binds, order };
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
    return { ...d, choices: [...d.choices, ...add].slice(0, MAX_OPEN_CHOICES) };
  });
  return changed ? next : null;
}
