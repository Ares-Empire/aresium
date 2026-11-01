// The website's light or dark, remembered in this browser: dark until switched with the header's button, then the last
// choice. Aresium (index.html: the dashboard and /demo) and its contact page (/contact, /kontakt) both load this file
// first in <head>, so each page opens in the same look without a flash of the other one. Red (Aresium mode) is not
// remembered: it is left when the page closes, as before. A page that links here can pass its own look for the visit,
// ?look=light or ?look=dark (patrikbreeck.com's apps page does for the contact page and /demo, so they open in the look
// the visitor came from): it wins over the remembered one and is not remembered itself (the dashboard saves its look
// once as it opens, which is skipped then; a switch afterwards is remembered as always); the contact form keeps it in
// the address and the language link (forms/contact-form.js keeps the page's parameters).
(function () {
  "use strict";
  var KEY = "aresium-appearance";

  var match = /[?&]look=(light|dark)(&|$)/.exec((window.location && window.location.search) || "");
  var passed = match ? match[1] : null;
  var opening = !!passed;   // the dashboard's first save, as it opens in the passed look

  // "light" or "dark": the passed look, else the remembered one; the storage can be missing or blocked (private
  // windows), which means dark.
  function load() {
    if (passed) return passed;
    try { return window.localStorage.getItem(KEY) === "light" ? "light" : "dark"; } catch (e) { return "dark"; }
  }

  // Remembers "light" or "dark"; anything else (red) changes nothing.
  function save(look) {
    if (look !== "light" && look !== "dark") return;
    if (opening) { opening = false; if (look === passed) return; }
    try {
      if (look === "light") window.localStorage.setItem(KEY, "light");
      else window.localStorage.removeItem(KEY);
    } catch (e) { /* not remembered; the page still switches */ }
  }

  window.AresiumAppearance = { load: load, save: save };
  document.documentElement.setAttribute("data-theme", load());
})();
