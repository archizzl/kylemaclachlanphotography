/*
 * Shows a friend's posts or photos on any web page.
 *
 *   <script src="https://kylemaclachlanphotography.org/embed.js" data-user="maya" data-post="my-post" async></script>
 *   <script src="https://kylemaclachlanphotography.org/embed.js" data-user="maya" data-list="10" async></script>
 *   <script src="https://kylemaclachlanphotography.org/embed.js" data-user="maya" data-image="beach.jpg" async></script>
 *
 * Options: data-style="none" (no styling of its own), data-title="no" (leave post titles out),
 * data-caption="no" (leave an image's caption out).
 *
 * Everything is inserted as plain HTML right where the <script> tag is (no iframe), so the page's
 * own CSS applies. The few default styles below have zero specificity (:where), and go first in
 * <head>, so any rule the page writes for the kmp-* classes wins.
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
      ":where(.kmp-post) blockquote{margin-left:0;padding-left:1em;border-left:2px solid currentColor;opacity:.85}" +
      ":where(.kmp-date){display:block;opacity:.6;font-size:.85em;margin:-.4em 0 1em}" +
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

  function longDate(d) {
    var t = new Date(d + "T12:00:00");
    return isNaN(t) ? d : t.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  function article(post, opts) {
    var a = el("article", "kmp-post");
    a.setAttribute("data-slug", post.slug);
    if (opts.titles) {
      var h = el("h2", "kmp-title");
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

  function run(script) {
    script.setAttribute("data-kmp-done", "1");
    var user = script.getAttribute("data-user");
    var slug = script.getAttribute("data-post");
    var image = script.getAttribute("data-image");
    var list = script.getAttribute("data-list");
    var opts = {
      titles: script.getAttribute("data-title") !== "no",
      captions: script.getAttribute("data-caption") !== "no",
      list: !slug && !image,
    };
    if (!user) return;
    if (script.getAttribute("data-style") !== "none") css();

    var box = el("div", "kmp-embed");
    script.parentNode.insertBefore(box, script.nextSibling);

    var base = new URL(script.src, location.href).origin + "/" + encodeURIComponent(user) + "/";
    var url = image
      ? base + "images/" + encodeURIComponent(image) + ".json"
      : slug
        ? base + encodeURIComponent(slug) + ".json"
        : base + "posts.json?limit=" + (parseInt(list, 10) || 10);

    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then(function (data) {
        if (data.image) return box.appendChild(figure(data.image, opts));
        var posts = data.post ? [data.post] : data.posts || [];
        posts.forEach(function (p) {
          box.appendChild(article(p, opts));
        });
      })
      .catch(function () {
        box.appendChild(el("p", "kmp-error", image ? "this photo couldn't be loaded." : slug ? "this post couldn't be loaded." : "posts couldn't be loaded."));
      });
  }

  // Handle every embed on the page that hasn't run yet (works with async and repeated tags).
  var scripts = document.querySelectorAll("script[data-user]:not([data-kmp-done])");
  for (var i = 0; i < scripts.length; i++) {
    if (/\/embed\.js(\?|$)/.test(scripts[i].src)) run(scripts[i]);
  }
})();
