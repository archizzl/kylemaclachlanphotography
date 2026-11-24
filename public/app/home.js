// Front page: clicking a photo (in the bottom row or inside a post) opens it bigger.
(function () {
  var viewer = document.getElementById("viewer");
  if (!viewer || !viewer.showModal) return;
  var img = viewer.querySelector("img");
  var text = viewer.querySelector("p");

  document.addEventListener("click", function (ev) {
    var row = ev.target.closest(".photos a");
    var inPost = ev.target.closest(".kmp-body img");
    if (!row && !inPost) return;
    ev.preventDefault();
    var src = row ? row.href : inPost.src;
    var alt = (row ? row.querySelector("img") : inPost).alt;
    img.src = src;
    img.alt = alt;
    var caption = row ? row.getAttribute("data-caption") : "";
    var by = row ? row.getAttribute("data-by") : "";
    text.textContent = [caption || alt, by && "from " + by].filter(Boolean).join(" · ");
    viewer.showModal();
  });
  viewer.addEventListener("click", function (ev) {
    if (ev.target === viewer || ev.target.tagName === "BUTTON") viewer.close();
  });
})();

// Above the title: cycle through the accepted sign-ups' photos of Kyle MacLachlan.
(function () {
  var img = document.querySelector("img.kyle");
  if (!img) return;
  var list;
  try { list = JSON.parse(img.getAttribute("data-kyle")) || []; } catch (e) { return; }
  if (list.length < 2) return;
  var i = 0;
  for (var j = 0; j < list.length; j++) if (img.src === list[j].src) i = j;
  function show(k) {
    var next = new Image();
    next.onload = function () {
      img.src = list[k].src;
      img.alt = list[k].alt;
      if (list[k].w) { img.width = list[k].w; img.height = list[k].h; } else { img.removeAttribute("width"); img.removeAttribute("height"); }
    };
    next.src = list[k].src;
  }
  setInterval(function () {
    if (document.hidden) return;
    i = (i + 1) % list.length;
    show(i);
  }, 4000);
})();
