// Front page: clicking a photo (in the bottom row or inside a post) opens it bigger.
(function () {
  var viewer = document.getElementById("viewer");
  if (!viewer || !viewer.showModal) return;
  var img = viewer.querySelector("img");
  var text = viewer.querySelector("p");

  document.addEventListener("click", function (ev) {
    var row = ev.target.closest(".photos a");
    var inPost = ev.target.closest(".post .body img");
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
