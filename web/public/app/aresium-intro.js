/* Aresium — wordmark intro transition (window.AresiumIntro).

   Replaces the paint pour for the red/Aresium-mode toggle. The big "ARESIUM" wordmark
   flies up from below to a centred HERO, vibrates as it lands, then settles down into its
   home (the bottom band) while the background smoothly morphs between themes. Exiting plays
   the mirror: the word lifts off the band to the hero, vibrates, and flies off below as the
   background morphs back.

   Self-contained: it builds its own fullscreen overlay (a morphing background layer + a copy
   of the band wordmark) and animates it with the Web Animations API. The real `.aresium-band`
   is hidden for the duration (CSS `.ares-intro-running`) so only the overlay word shows; the
   real theme is swapped underneath while the background overlay covers the page, so at the end
   the overlay is removed and the real band sits exactly where the word landed — seamless.

     play({ entering, target, onSwap, onDone })
        entering  true = entering red (fly in), false = exiting red (fly out)
        target    theme being switched TO (drives the background-morph colour)
        onSwap    called once the page is covered → swap the real theme here
        onDone    called when the overlay is removed

   Honours prefers-reduced-motion (swaps instantly). Tunables in CFG. */
(function () {
  "use strict";

  // backgrounds per theme (kept in sync with index.html body backgrounds)
  const THEME_BG = {
    dark: "#050507",
    light: "#ecedf2",
    red:
      "radial-gradient(62% 32% at 50% -16%, rgba(158,20,44,0.32), rgba(0,0,0,0) 56%)," +
      "radial-gradient(72% 56% at 86% 122%, rgba(20,1,6,0.92), rgba(0,0,0,0) 56%)," +
      "linear-gradient(176deg, #520a1a 0%, #320510 52%, #140206 100%)",
  };

  const CFG = {
    total: 1500,     // ms, whole transition
    bgFrac: 0.5,     // background finishes morphing by this fraction of the timeline
    swapAt: 0.56,    // swap the real theme here (after the bg overlay has covered the page)
    heroY: -30,      // vh: hero vertical offset (negative = up toward centre)
    heroScale: 1.18, // hero size
  };

  let prefersReduced = false;
  try { prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) {}
  let busy = false;

  // one transform with a fixed function list so WAAPI interpolates cleanly across keyframes
  const t = (y, x, r, s) => `translateY(${y}vh) translateX(${x}px) rotate(${r}deg) scale(${s})`;

  function build(target) {
    const o = document.createElement("div");
    o.className = "ares-intro"; o.setAttribute("aria-hidden", "true");
    Object.assign(o.style, { position: "fixed", inset: "0", zIndex: "60", pointerEvents: "none", overflow: "hidden" });

    const bg = document.createElement("div");
    Object.assign(bg.style, { position: "absolute", inset: "0", background: THEME_BG[target] || THEME_BG.dark, willChange: "opacity" });

    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      position: "absolute", left: "0", right: "0", bottom: "0", height: "17vh", minHeight: "96px",
      display: "flex", alignItems: "flex-end", justifyContent: "center", willChange: "transform",
    });
    const word = document.createElement("div");
    word.className = "aresium-word";            // reuse the exact band styling
    "ARESIUM".split("").forEach((ch) => { const s = document.createElement("span"); s.textContent = ch; word.appendChild(s); });
    wrap.appendChild(word);

    o.appendChild(bg); o.appendChild(wrap);
    return { o, bg, word };
  }

  const H = CFG.heroY, S = CFG.heroScale;
  const enterWord = [
    { offset: 0.00, transform: t(60, 0, 0, 1.04), opacity: 0 },
    { offset: 0.26, transform: t(H, 0, 0, S), opacity: 1, easing: "cubic-bezier(.16,.84,.3,1.12)" },
    { offset: 0.30, transform: t(H, -8, -0.5, S) },
    { offset: 0.345, transform: t(H - 0.6, 7, 0.5, S) },
    { offset: 0.39, transform: t(H + 0.4, -5, -0.3, S) },
    { offset: 0.435, transform: t(H, 4, 0.2, S) },
    { offset: 0.48, transform: t(H, 0, 0, S), easing: "cubic-bezier(.5,0,.18,1)" },
    { offset: 1.00, transform: t(0, 0, 0, 1), opacity: 1 },
  ];
  const exitWord = [
    { offset: 0.00, transform: t(0, 0, 0, 1), opacity: 1 },
    { offset: 0.30, transform: t(H, 0, 0, S), opacity: 1, easing: "cubic-bezier(.16,.84,.3,1.12)" },
    { offset: 0.345, transform: t(H, -8, -0.5, S) },
    { offset: 0.39, transform: t(H - 0.6, 7, 0.5, S) },
    { offset: 0.435, transform: t(H + 0.4, -5, -0.3, S) },
    { offset: 0.48, transform: t(H, 4, 0.2, S) },
    { offset: 0.54, transform: t(H, 0, 0, S), easing: "cubic-bezier(.4,0,.7,.25)" },
    { offset: 1.00, transform: t(70, 0, 0, 1.04), opacity: 0 },
  ];

  function run(entering, target, onSwap, onDone) {
    const { o, bg, word } = build(target);
    document.body.classList.add("ares-intro-running");   // hide the real band(s)
    document.body.appendChild(o);

    bg.animate([{ opacity: 0 }, { opacity: 1 }],
      { duration: CFG.total * CFG.bgFrac, easing: "cubic-bezier(.4,0,.2,1)", fill: "both" });
    const wordAnim = word.animate(entering ? enterWord : exitWord,
      { duration: CFG.total, easing: "linear", fill: "both" });

    const swapTimer = setTimeout(() => { if (onSwap) onSwap(); }, CFG.total * CFG.swapAt);

    const finish = () => {
      clearTimeout(swapTimer);
      if (o.parentNode) o.parentNode.removeChild(o);
      document.body.classList.remove("ares-intro-running");
      busy = false;
      if (onDone) onDone();
    };
    wordAnim.finished.then(finish).catch(finish);
  }

  window.AresiumIntro = {
    play(opts) {
      opts = opts || {};
      if (busy) return;
      busy = true;
      if (prefersReduced) {
        if (opts.onSwap) opts.onSwap();
        busy = false;
        if (opts.onDone) opts.onDone();
        return;
      }
      run(!!opts.entering, opts.target, opts.onSwap, opts.onDone);
    },
  };
})();
