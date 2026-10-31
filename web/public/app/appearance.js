// The website's light or dark, remembered in this browser: dark until switched with the header's button, then the last
// choice. Aresium (index.html: the dashboard and /demo) and its contact page (/contact, /kontakt) both load this file
// first in <head>, so each page opens in the same look without a flash of the other one. Red (Aresium mode) is not
// remembered: it is left when the page closes, as before.
(function () {
  "use strict";
  var KEY = "aresium-appearance";

  // "light" or "dark"; the storage can be missing or blocked (private windows), which means dark.
  function load() {
    try { return window.localStorage.getItem(KEY) === "light" ? "light" : "dark"; } catch (e) { return "dark"; }
  }

  // Remembers "light" or "dark"; anything else (red) changes nothing.
  function save(look) {
    if (look !== "light" && look !== "dark") return;
    try {
      if (look === "light") window.localStorage.setItem(KEY, "light");
      else window.localStorage.removeItem(KEY);
    } catch (e) { /* not remembered; the page still switches */ }
  }

  window.AresiumAppearance = { load: load, save: save };
  document.documentElement.setAttribute("data-theme", load());
})();
