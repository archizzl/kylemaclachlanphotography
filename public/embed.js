/*
 * Shows a friend's posts on any web page.
 *
 *   <script src="https://kylemaclachlanphotography.org/embed.js" data-user="maya" data-post="my-post" async></script>
 *   <script src="https://kylemaclachlanphotography.org/embed.js" data-user="maya" data-list="10" async></script>
 *
 * Options: data-style="none" (no styling of its own), data-title="no" (leave titles out).
 * The posts appear right where the <script> tag is. The post HTML comes from the server, which
 * escapes anything typed as HTML, so it's safe to insert.
 */
(function () {
  "use strict";

  function css() {
    if (document.getElementById("kmp-embed-style")) return;
    var s = document.createElement("style");
    s.id = "kmp-embed-style";
    s.textContent =
      ".kmp-post{margin:0 0 2.5em}" +
      ".kmp-post img{max-width:100%;height:auto}" +
      ".kmp-post pre{overflow:auto}" +
      ".kmp-post blockquote{margin-left:0;padding-left:1em;border-left:2px solid currentColor;opacity:.85}" +
      ".kmp-date{display:block;opacity:.6;font-size:.85em;margin:-.4em 0 1em}" +
      ".kmp-error{opacity:.6;font-style:italic}";
    (document.head || document.documentElement).appendChild(s);
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

  function run(script) {
    script.setAttribute("data-kmp-done", "1");
    var user = script.getAttribute("data-user");
    var slug = script.getAttribute("data-post");
    var list = script.getAttribute("data-list");
    var opts = { titles: script.getAttribute("data-title") !== "no", list: !slug };
    if (!user) return;
    if (script.getAttribute("data-style") !== "none") css();

    var box = el("div", "kmp-embed");
    script.parentNode.insertBefore(box, script.nextSibling);

    var origin = new URL(script.src, location.href).origin;
    var url = slug
      ? origin + "/" + encodeURIComponent(user) + "/" + encodeURIComponent(slug) + ".json"
      : origin + "/" + encodeURIComponent(user) + "/posts.json?limit=" + (parseInt(list, 10) || 10);

    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then(function (data) {
        var posts = data.post ? [data.post] : data.posts || [];
        posts.forEach(function (p) {
          box.appendChild(article(p, opts));
        });
      })
      .catch(function () {
        box.appendChild(el("p", "kmp-error", slug ? "this post couldn't be loaded." : "posts couldn't be loaded."));
      });
  }

  // Handle every embed on the page that hasn't run yet (works with async and repeated tags).
  var scripts = document.querySelectorAll("script[data-user]:not([data-kmp-done])");
  for (var i = 0; i < scripts.length; i++) {
    if (/\/embed\.js(\?|$)/.test(scripts[i].src)) run(scripts[i]);
  }
})();
