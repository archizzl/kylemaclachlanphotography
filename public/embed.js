/*
 * Shows a friend's posts or photos on any web page.
 *
 *   <script src="https://kylemaclachlanphotography.org/embed.js" data-user="maya" data-post="my-post" async></script>
 *   <script src="https://kylemaclachlanphotography.org/embed.js" data-user="maya" data-list="10" async></script>
 *   (data-list="all" shows every post, however many there are)
 *   <script src="https://kylemaclachlanphotography.org/embed.js" data-user="maya" data-image="beach.jpg" async></script>
 *
 * Lists can use the blog's own post fields (set up in the dashboard's settings):
 *   data-filter="emotion:tender"   only posts with that value (several: separate with commas)
 *   data-sort="number"             sort by a field, or "date" for oldest first; "-number" reverses
 *   data-group="emotion"           a heading for each value, with its posts under it
 *   data-menu="emotion"            buttons readers click to show one value at a time; the post's own
 *                                  tags for that field become clickable too
 *   data-menu-label="filter by feeling"   the words before those buttons (default: the field's name)
 *
 * Other options: data-style="none" (no styling of its own), data-title="no" (no post titles),
 * data-fields="no" (don't show field values), data-caption="no" (no photo caption).
 *
 * Everything is inserted as plain HTML right where the <script> tag is (no iframe), so the page's
 * own CSS applies. The default styles below have zero specificity (:where) and go first in <head>,
 * so any rule the page writes wins. Hooks for styling:
 *   .kmp-post[data-emotion~="tender"]   every post carries its tag values as data attributes
 *   .kmp-fields .kmp-field[data-kind] .kmp-field-name .kmp-tag[data-value="tender"]  (tags show as #tag by default)
 *   .kmp-menu .kmp-menu-label .kmp-menu button[aria-pressed="true"]   .kmp-group[data-value]   .kmp-group-title
 *
 * The HTML comes from the server, which escapes anything typed as HTML, so it's safe to insert.
 */
(function () {
  "use strict";

  function css() {
    if (document.getElementById("kmp-embed-style")) return;
    var s = document.createElement("style");
    s.id = "kmp-embed-style";
    s.textContent =
      ":where(.kmp-post){display:block;margin:0 0 2.5em}" +
      ":where(.kmp-post, .kmp-image) img{max-width:100%;height:auto}" +
      ":where(.kmp-post) pre{overflow:auto}" +
      ":where(.kmp-post) .box{display:inline-block;border:1px solid currentColor;padding:0 .4em;border-radius:3px}" +
      ":where(.kmp-post) blockquote{margin-left:0;padding-left:1em;border-left:2px solid currentColor;opacity:.85}" +
      ":where(.kmp-date){display:block;opacity:.6;font-size:.85em;margin:-.4em 0 1em}" +
      ":where(.kmp-fields){display:flex;flex-wrap:wrap;gap:.3em 1em;font-size:.85em;margin:-.6em 0 1em}" +
      ":where(.kmp-field-name){opacity:.6;margin-right:.3em}" +
      // Tags look like archizzl.com's: muted #tags, no label, underlined on hover.
      ":where(.kmp-field[data-kind=tags] .kmp-field-name){display:none}" +
      ":where(.kmp-tag){opacity:.55;margin-right:.5em}" +
      ":where(.kmp-tag)::before{content:'#'}" +
      ":where(button.kmp-tag:hover){text-decoration:underline;opacity:1}" +
      ":where(.kmp-menu){display:flex;flex-wrap:wrap;align-items:center;gap:.4em;margin:0 0 1.5em}" +
      ":where(.kmp-menu-label){opacity:.7;margin-right:.3em}" +
      ":where(button.kmp-tag){font:inherit;font-size:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}" +
      ":where(.kmp-menu button){font:inherit;color:inherit;background:none;border:0;padding:0 .2em;cursor:pointer;opacity:.55}" +
      ":where(.kmp-menu button:hover){text-decoration:underline;opacity:1}" +
      ":where(.kmp-menu button:not([data-value='']))::before{content:'#'}" +
      ":where(.kmp-menu button[aria-pressed=true]){opacity:1;font-weight:bold;text-decoration:underline}" +
      ":where(.kmp-group-title){margin:1.5em 0 .8em}" +
      ":where(.kmp-image){margin:1em 0}" +
      ":where(.kmp-image) img{display:block}" +
      ":where(.kmp-image figcaption){opacity:.7;font-size:.85em;margin-top:.4em}" +
      ":where(.kmp-error){opacity:.6;font-style:italic}";
    var head = document.head || document.documentElement;
    head.insertBefore(s, head.firstChild);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // "Very Sad!" -> "very-sad", for data attributes and CSS selectors.
  function slug(v) {
    return String(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function longDate(d) {
    var t = new Date(d + "T12:00:00");
    return isNaN(t) ? d : t.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  function valuesOf(post, key) {
    var v = (post.fields || {})[key];
    return v == null ? [] : Array.isArray(v) ? v : [v];
  }

  function fieldList(post, defs, clickable) {
    var box = el("div", "kmp-fields");
    defs.forEach(function (d) {
      var vals = valuesOf(post, d.key);
      if (!vals.length) return;
      var f = el("span", "kmp-field kmp-field-" + d.key);
      f.setAttribute("data-field", d.key);
      f.setAttribute("data-kind", d.kind);
      f.appendChild(el("span", "kmp-field-name", d.name));
      vals.forEach(function (v) {
        if (d.kind === "tags") {
          var t = el(d.key === clickable ? "button" : "span", "kmp-tag", v);
          if (d.key === clickable) {
            t.type = "button";
            t.title = "show only “" + v + "”";
          }
          t.setAttribute("data-value", slug(v));
          f.appendChild(t);
        } else {
          f.appendChild(el("span", "kmp-field-value", String(v)));
        }
      });
      box.appendChild(f);
    });
    return box.childNodes.length ? box : null;
  }

  function article(post, defs, opts) {
    var a = el("article", "kmp-post");
    a.setAttribute("data-slug", post.slug);
    defs.forEach(function (d) {
      var vals = valuesOf(post, d.key);
      if (vals.length) a.setAttribute("data-" + d.key.replace(/_/g, "-"), vals.map(slug).join(" "));
    });
    if (opts.titles) {
      var h = el(opts.grouped ? "h3" : "h2", "kmp-title");
      if (opts.list && post.url && !/\.md$/.test(post.url)) {
        var link = el("a", null, post.title);
        link.href = post.url;
        h.appendChild(link);
      } else {
        h.textContent = post.title;
      }
      a.appendChild(h);
      var time = el("time", "kmp-date", longDate(post.date));
      time.setAttribute("datetime", post.date);
      a.appendChild(time);
    }
    if (opts.fields) {
      var fl = fieldList(post, defs, opts.menu);
      if (fl) a.appendChild(fl);
    }
    var body = el("div", "kmp-body");
    body.innerHTML = post.html;
    a.appendChild(body);
    return a;
  }

  function figure(image, opts) {
    var f = el("figure", "kmp-image");
    var img = document.createElement("img");
    img.src = image.url;
    img.alt = image.alt || "";
    img.loading = "lazy";
    if (image.width && image.height) {
      img.width = image.width;
      img.height = image.height;
    }
    f.appendChild(img);
    if (opts.captions && image.caption_html) {
      var cap = el("figcaption");
      cap.innerHTML = image.caption_html;
      f.appendChild(cap);
    }
    return f;
  }

  // The values a field can take, in the blog's order (tags) or the order they first appear.
  function valuesInOrder(def, posts) {
    var seen = [];
    (def.kind === "tags" ? def.choices || [] : []).forEach(function (c) { seen.push(c); });
    posts.forEach(function (p) {
      valuesOf(p, def.key).forEach(function (v) {
        if (!seen.some(function (s) { return slug(s) === slug(v); })) seen.push(v);
      });
    });
    return seen;
  }

  // Hide or show an element even if the page's CSS gives it a display value (which beats [hidden]).
  function show(node, visible) {
    node.hidden = !visible;
    node.style.display = visible ? "" : "none";
  }

  function hasValue(post, key, value) {
    return valuesOf(post, key).some(function (v) { return slug(v) === slug(value); });
  }

  function renderList(box, data, opts) {
    var posts = data.posts || [];
    var defs = (data.user && data.user.fields) || [];
    var byKey = {};
    defs.forEach(function (d) { byKey[d.key] = d; });
    var groupDef = byKey[opts.group];
    var menuDef = byKey[opts.menu];

    if (menuDef) {
      var menu = el("nav", "kmp-menu");
      var label = el("span", "kmp-menu-label", opts.menuLabel || menuDef.name);
      label.id = "kmp-menu-" + Math.random().toString(36).slice(2);
      menu.setAttribute("aria-labelledby", label.id);
      menu.appendChild(label);
      var values = [""].concat(valuesInOrder(menuDef, posts).filter(function (v) {
        return posts.some(function (p) { return hasValue(p, menuDef.key, v); });
      }));
      values.forEach(function (v) {
        var b = el("button");
        b.appendChild(el("span", null, v || "all"));
        b.type = "button";
        b.setAttribute("data-value", v ? slug(v) : "");
        b.setAttribute("aria-pressed", v ? "false" : "true");
        b.addEventListener("click", function () {
          [].forEach.call(menu.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
          [].forEach.call(box.querySelectorAll(".kmp-post"), function (a) {
            var mine = (a.getAttribute("data-" + menuDef.key.replace(/_/g, "-")) || "").split(" ");
            show(a, !v || mine.indexOf(slug(v)) >= 0);
          });
          [].forEach.call(box.querySelectorAll(".kmp-group"), function (g) {
            show(g, Boolean(g.querySelector(".kmp-post:not([hidden])")));
          });
        });
        menu.appendChild(b);
      });
      box.appendChild(menu);
      // Clicking a tag on a post picks that tag in the menu.
      box.addEventListener("click", function (ev) {
        var tag = ev.target.closest && ev.target.closest("button.kmp-tag");
        if (!tag) return;
        var match = menu.querySelector('button[data-value="' + tag.getAttribute("data-value") + '"]');
        if (!match) return;
        match.click();
        if (menu.getBoundingClientRect().top < 0) menu.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    if (groupDef) {
      var opt = Object.assign({}, opts, { grouped: true });
      valuesInOrder(groupDef, posts).forEach(function (v) {
        var mine = posts.filter(function (p) { return hasValue(p, groupDef.key, v); });
        if (!mine.length) return;
        var g = el("section", "kmp-group");
        g.setAttribute("data-field", groupDef.key);
        g.setAttribute("data-value", slug(v));
        g.appendChild(el("h2", "kmp-group-title", v));
        mine.forEach(function (p) { g.appendChild(article(p, defs, opt)); });
        box.appendChild(g);
      });
      var rest = posts.filter(function (p) { return !valuesOf(p, groupDef.key).length; });
      if (rest.length) {
        var other = el("section", "kmp-group");
        other.setAttribute("data-field", groupDef.key);
        other.setAttribute("data-value", "");
        other.appendChild(el("h2", "kmp-group-title", "everything else"));
        rest.forEach(function (p) { other.appendChild(article(p, defs, opt)); });
        box.appendChild(other);
      }
    } else {
      posts.forEach(function (p) { box.appendChild(article(p, defs, opts)); });
    }
    if (!posts.length) box.appendChild(el("p", "kmp-empty", "no posts here yet."));
  }

  function run(script) {
    script.setAttribute("data-kmp-done", "1");
    var attr = function (n) { return script.getAttribute("data-" + n); };
    var user = attr("user");
    var slugAttr = attr("post");
    var image = attr("image");
    var opts = {
      titles: attr("title") !== "no",
      captions: attr("caption") !== "no",
      fields: attr("fields") !== "no",
      list: !slugAttr && !image,
      group: attr("group"),
      menu: attr("menu"),
      menuLabel: attr("menu-label"),
    };
    if (!user) return;
    if (attr("style") !== "none") css();

    var box = el("div", "kmp-embed");
    script.parentNode.insertBefore(box, script.nextSibling);

    var base = new URL(script.src, location.href).origin + "/" + encodeURIComponent(user) + "/";
    var url;
    if (image) url = base + "images/" + encodeURIComponent(image) + ".json";
    else if (slugAttr) url = base + encodeURIComponent(slugAttr) + ".json";
    else {
      var q = new URLSearchParams();
      var wantAll = attr("list") === "all";
      var want = wantAll ? Infinity : parseInt(attr("list"), 10) || (opts.group || opts.menu ? 50 : 10);
      (attr("filter") || "").split(",").forEach(function (f) { if (f.trim()) q.append("filter", f.trim()); });
      if (attr("sort")) q.set("sort", attr("sort"));
      url = base + "posts.json?" + q.toString();
    }

    function getJson(u) {
      return fetch(u).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      });
    }
    // The server answers 50 posts at a time; for longer lists, keep asking until there are enough.
    function getList() {
      var PAGE = 50, posts = [], user;
      function next(offset) {
        var take = Math.min(PAGE, want - posts.length);
        return getJson(url + "&limit=" + take + "&offset=" + offset).then(function (d) {
          user = d.user;
          posts = posts.concat(d.posts || []);
          var done = (d.posts || []).length < take || posts.length >= want;
          return done ? { user: user, posts: posts } : next(offset + take);
        });
      }
      return next(0);
    }

    (image || slugAttr ? getJson(url) : getList())
      .then(function (data) {
        if (data.image) return box.appendChild(figure(data.image, opts));
        if (data.post) return box.appendChild(article(data.post, (data.user && data.user.fields) || [], opts));
        renderList(box, data, opts);
      })
      .catch(function () {
        box.appendChild(el("p", "kmp-error", image ? "this photo couldn't be loaded." : slugAttr ? "this post couldn't be loaded." : "posts couldn't be loaded."));
      });
  }

  // Handle every embed on the page that hasn't run yet (works with async and repeated tags).
  var scripts = document.querySelectorAll("script[data-user]:not([data-kmp-done])");
  for (var i = 0; i < scripts.length; i++) {
    if (/\/embed\.js(\?|$)/.test(scripts[i].src)) run(scripts[i]);
  }
})();
