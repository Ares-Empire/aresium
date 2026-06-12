/* Aresium — poured-paint transition (window.AresiumPaint).

   Replaces the CSS curtain (`.paint` in index.html) used when toggling red/Aresium
   mode. Instead of a warped sliding sheet, this renders a *lit, wet, drippy* sheet
   of red paint that sweeps down through the viewport: finite-difference surface
   normals drive a directional diffuse term + a tight Blinn-Phong specular (the wet
   gloss), the red tint deepens with paint thickness, and the leading/trailing edges
   break into rounded drip tendrils. The whole sheet slides top→bottom on one eased
   timeline — same motion as the old curtain, so the theme can be swapped mid-sweep
   (onCovered) while the screen is fully covered, then revealed (onDone) as it leaves.

   Self-contained: it owns its own <canvas> overlay and rAF loop, depends on nothing
   else in the app, and exposes only window.AresiumPaint:

     prewarm()                       — create the GL context + compile shaders early
                                       so the first real pour isn't janky (optional).
     pour({ onCovered, onDone })     — run one sweep. onCovered fires once the sheet
                                       fully covers the viewport (swap the theme here);
                                       onDone fires when the sheet has left and the
                                       overlay is removed.

   If WebGL is unavailable or the user prefers reduced motion, it falls back to the
   original CSS `.paint` curtain (built imperatively here, same look as before) so
   behaviour never regresses. The procedural-surface choice (vs. a full GPU fluid
   sim) is deliberate: it's deterministic, dependency-free, and robust across
   devices — see docs/DESIGN-NOTES.md #1. */
(function () {
  "use strict";

  // ---- timeline (ms) -------------------------------------------------------
  // Mirrors the old curtain so the hidden theme-swap stays hidden: total ~1.56s,
  // fully covering the viewport around the midpoint.
  const TOTAL = 1560;
  const COVER_AT = 0.49;   // fraction of TOTAL at which onCovered fires (screen covered)

  // ---- tunables (passed to the shader as uniforms) -------------------------
  // Centralised so the look can be tuned without touching GLSL. Colours are linear-ish
  // sRGB; "deep" is where the paint is thickest (more pigment), "lit" the thinner edge.
  const CFG = {
    canvasVh: 1.8,         // canvas height as a multiple of viewport height
    bodyTop: 0.16,         // solid body spans [bodyTop, bodyBot] of the canvas (rest = drips)
    bodyBot: 0.90,
    dripGrow: 0.16,        // how far the leading tendrils stretch (uv units) over the sweep
    deep: [0.085, 0.015, 0.035],
    lit:  [0.62, 0.05, 0.12],
    spec: [1.0, 0.86, 0.86],
    specPower: 55.0,
    normalStrength: 26.0,  // finite-difference normal exaggeration
    light: [-0.35, -0.55, 0.78],
    seed: 6.0,
    maxDpr: 1.5,
  };

  const VERT = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;        // 0..1, y up
      gl_Position = vec4(aPos, 0.0, 1.0);
    }`;

  const FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform vec2  uRes;        // drawing-buffer size (px)
    uniform float uT;          // 0..1 sweep progress (sheet-internal drip growth)
    uniform float uSeed;
    uniform float uBodyTop, uBodyBot, uDripGrow, uNormStr, uSpecPow;
    uniform vec3  uDeep, uLit, uSpec, uLight;

    float hash(float n){ return fract(sin(n * 127.1 + uSeed * 13.7) * 43758.5453); }
    float vnoise(float x){
      float i = floor(x), f = fract(x);
      f = f * f * (3.0 - 2.0 * f);
      return mix(hash(i), hash(i + 1.0), f);
    }

    // y increases downward here (paint flows down). Lower drip front: the leading
    // edge — a broad wobble plus a few columns that elongate into tendrils over time.
    float lowFront(float x, float t){
      float base = uBodyBot;
      float wobble = (vnoise(x * 6.0) - 0.5) * 0.045;
      float cell = floor(x * 9.0);
      float pick = hash(cell + 3.1);
      float tendril = smoothstep(0.55, 1.0, pick) * (0.04 + 0.13 * pick);
      float withinCol = 1.0 - abs(fract(x * 9.0) - 0.5) * 2.0;  // 1 at column centre, 0 at edges
      float shape = smoothstep(0.0, 0.5, withinCol);
      return base + wobble + tendril * shape * (0.3 + 0.7 * t) * uDripGrow;
    }
    // Upper (trailing) edge — gentle wobble, retreats slightly as paint drains down.
    float highFront(float x, float t){
      return uBodyTop + (vnoise(x * 7.0 + 5.0) - 0.5) * 0.038 - 0.02 * t;
    }

    // Paint thickness at p (uv, y down). Solid in the body, tapering to 0 at both
    // fronts so the edges read as rounded lips, with an extra bead near the leading lip.
    float heightAt(vec2 p){
      float lo = lowFront(p.x, uT);
      float hi = highFront(p.x, uT);
      float inBody = smoothstep(hi, hi + 0.02, p.y) * (1.0 - smoothstep(lo - 0.03, lo, p.y));
      float lip = (1.0 - smoothstep(lo - 0.045, lo, p.y)) * smoothstep(lo - 0.065, lo - 0.045, p.y);
      return clamp(inBody + lip * 0.6, 0.0, 1.0);
    }

    void main(){
      vec2 p = vec2(vUv.x, 1.0 - vUv.y);   // flip so y is down
      float h = heightAt(p);
      if (h <= 0.002) discard;             // outside the sheet / between tendrils

      // surface normal from the thickness gradient (finite differences)
      float e = 1.0 / uRes.y;
      float hl = heightAt(p + vec2(-e, 0.0)), hr = heightAt(p + vec2(e, 0.0));
      float hu = heightAt(p + vec2(0.0, -e)), hd = heightAt(p + vec2(0.0, e));
      vec3 n = normalize(vec3((hl - hr) * uNormStr, (hd - hu) * uNormStr, 1.0));

      vec3 base = mix(uLit, uDeep, clamp(h, 0.0, 1.0));   // thicker = deeper red
      vec3 L = normalize(uLight);
      float diff = clamp(dot(n, L), 0.0, 1.0);
      vec3 Hh = normalize(L + vec3(0.0, 0.0, 1.0));
      float spec = pow(clamp(dot(n, Hh), 0.0, 1.0), uSpecPow);

      // a wet sheen band travelling down the freshly poured paint
      float sheen = smoothstep(0.07, 0.0, abs(p.y - (uT * 1.25 - 0.12))) * 0.22;

      vec3 col = base * (0.4 + 0.72 * diff) + uSpec * spec + sheen;
      float a = smoothstep(0.0, 0.12, h);
      gl_FragColor = vec4(col, a);
    }`;

  let prefersReduced = false;
  try { prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) {}

  let busy = false;          // one pour at a time
  let gl = null, prog = null, uni = null, canvas = null, ready = false, failed = false;

  function compile(g, type, src) {
    const sh = g.createShader(type);
    g.shaderSource(sh, src); g.compileShader(sh);
    if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) {
      throw new Error("paint shader: " + g.getShaderInfoLog(sh));
    }
    return sh;
  }

  function makeCanvas() {
    const c = document.createElement("canvas");
    c.setAttribute("aria-hidden", "true");
    const s = c.style;
    s.position = "fixed"; s.left = "0"; s.width = "100vw";
    s.top = "0"; s.height = (CFG.canvasVh * 100) + "vh";
    s.zIndex = "60"; s.pointerEvents = "none"; s.willChange = "transform";
    s.transform = "translateY(-200vh)";   // parked above the screen until a pour starts
    return c;
  }

  // Lazily create the GL context + program. Returns false (and sets `failed`) if
  // WebGL is unavailable — callers then use the CSS fallback.
  function init() {
    if (ready) return true;
    if (failed) return false;
    try {
      canvas = makeCanvas();
      gl = canvas.getContext("webgl", { premultipliedAlpha: false, alpha: true, antialias: true })
        || canvas.getContext("experimental-webgl");
      if (!gl) throw new Error("no webgl");

      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error("paint link: " + gl.getProgramInfoLog(prog));
      }

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // fullscreen tri
      const loc = gl.getAttribLocation(prog, "aPos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      gl.useProgram(prog);
      uni = {};
      ["uRes", "uT", "uSeed", "uBodyTop", "uBodyBot", "uDripGrow", "uNormStr",
       "uSpecPow", "uDeep", "uLit", "uSpec", "uLight"].forEach((k) => {
        uni[k] = gl.getUniformLocation(prog, k);
      });

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      // static uniforms
      gl.uniform1f(uni.uSeed, CFG.seed);
      gl.uniform1f(uni.uBodyTop, CFG.bodyTop);
      gl.uniform1f(uni.uBodyBot, CFG.bodyBot);
      gl.uniform1f(uni.uDripGrow, CFG.dripGrow);
      gl.uniform1f(uni.uNormStr, CFG.normalStrength);
      gl.uniform1f(uni.uSpecPow, CFG.specPower);
      gl.uniform3fv(uni.uDeep, CFG.deep);
      gl.uniform3fv(uni.uLit, CFG.lit);
      gl.uniform3fv(uni.uSpec, CFG.spec);
      gl.uniform3fv(uni.uLight, CFG.light);

      ready = true;
      return true;
    } catch (err) {
      console.warn("[AresiumPaint] WebGL init failed, using CSS fallback:", err && err.message);
      failed = true;
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      canvas = null; gl = null; prog = null;
      return false;
    }
  }

  function sizeBuffer() {
    const dpr = Math.min(CFG.maxDpr, window.devicePixelRatio || 1);
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * CFG.canvasVh * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uni.uRes, w, h);
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function runGL(onCovered, onDone) {
    document.body.appendChild(canvas);
    sizeBuffer();
    // force a layout flush so the parked transform is applied before we animate
    void canvas.offsetHeight;

    const startTravel = -(CFG.canvasVh + 0.04) * 100;   // just above the viewport (vh)
    const endTravel = 104;                               // just below the viewport (vh)
    const start = performance.now();
    let covered = false;

    function frame(now) {
      const lin = Math.min(1, (now - start) / TOTAL);
      const e = easeInOutCubic(lin);
      const y = startTravel + (endTravel - startTravel) * e;
      canvas.style.transform = "translateY(" + y.toFixed(2) + "vh)";

      gl.uniform1f(uni.uT, lin);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (!covered && lin >= COVER_AT) { covered = true; if (onCovered) onCovered(); }

      if (lin < 1) {
        requestAnimationFrame(frame);
      } else {
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        canvas.style.transform = "translateY(-200vh)";
        busy = false;
        if (onDone) onDone();
      }
    }
    requestAnimationFrame(frame);
  }

  // CSS-curtain fallback — the original `.paint` element + timings, built imperatively.
  function runCSS(onCovered, onDone) {
    const el = document.createElement("div");
    el.className = "paint"; el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    void el.offsetHeight;                       // reflow so the .go transition runs
    requestAnimationFrame(() => el.classList.add("go"));
    setTimeout(() => { if (onCovered) onCovered(); }, Math.round(TOTAL * COVER_AT));
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
      busy = false;
      if (onDone) onDone();
    }, TOTAL);
  }

  window.AresiumPaint = {
    prewarm() {
      if (prefersReduced) return;
      try { init(); } catch (_) {}
    },
    pour(opts) {
      opts = opts || {};
      const onCovered = opts.onCovered, onDone = opts.onDone;
      if (busy) return;
      busy = true;
      if (prefersReduced || !init()) { runCSS(onCovered, onDone); return; }
      runGL(onCovered, onDone);
    },
  };
})();
