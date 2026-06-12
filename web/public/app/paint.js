/* Aresium — poured-paint transition (window.AresiumPaint).

   A real-time GPU fluid: red paint is poured at the top of the screen and flows down
   under gravity, accumulating, fingering into drips, and covering the viewport — then
   draining away to reveal the re-coloured UI. This is a genuine thin-film simulation,
   not a moving sheet.

   Technique (see docs/DESIGN-NOTES.md #1):
   - HEIGHT-FIELD SIM on the GPU (ping-pong framebuffers). A single channel stores paint
     thickness h(x,y). Each step: a semi-Lagrangian gravity advection whose speed grows
     with thickness (~h²) — the lubrication-approximation flux for a film on a vertical
     wall — which makes the advancing front steepen and break into finger-drips. Plus a
     little anisotropic diffusion (rounds drips), a noisy top source (the pour, with a
     few lead streams), and a coverage "floor" band that guarantees full opacity at the
     moment the theme is swapped (so the swap stays hidden) and recedes to reveal it.
   - WET SHADING in the render pass: surface normals from ∇h drive diffuse + a tight
     Blinn-Phong specular and a Fresnel rim (glossy wet look); Beer–Lambert pigment
     (1−e^(−k·h)) makes thin edges translucent and thick centres opaque deep red; and the
     normal refracts the backdrop (the outgoing theme colour) so wet edges bend it.

   Coordinates: vUv = aPos*0.5+0.5, so y increases UPWARD (matching GL texture rows —
   texel t=0 is the framebuffer bottom). Gravity therefore pulls toward y=0; the pour
   source sits near y=1 (top of screen).

   Public API (unchanged — app.jsx/mobile.jsx call these):
     prewarm()                    — create the GL context + compile shaders early.
     pour({ onCovered, onDone })  — run one pour. onCovered fires when the screen is fully
                                    covered (swap the theme here); onDone when it's done.

   Falls back to the original CSS `.paint` curtain (built imperatively) if WebGL / float
   targets are unavailable or the user prefers reduced motion — behaviour never regresses.
   All look/feel constants live in CFG so the result can be tuned on a real screen. */
(function () {
  "use strict";

  // ---- photoreal video asset (preferred when present) ----------------------
  // A real/offline-rendered paint-pour clip with alpha is FAR more realistic than any
  // real-time shader. When the asset loads, it's played as a transparent fullscreen
  // overlay and the theme is swapped at `coverAt`; if it's missing/unsupported, we fall
  // back to the GPU sim below, then the CSS curtain. Drop the render at web/public/assets/.
  // (Render recipe: tools/blender/paint_pour.py → ffmpeg → VP9+alpha .webm.)
  const VIDEO = {
    enabled: true,
    webm: "assets/paint-pour.webm",   // VP9 + alpha — Chrome / Firefox / Edge
    mov: "",                          // optional HEVC + alpha .mov for Safari/iOS ("" = none)
    coverAt: 1.9,                     // seconds into the clip when paint fully covers the screen
  };

  // ---- timeline (ms) — phases of one pour ----------------------------------
  const T_POUR = 720;    // paint pours in + covers the screen (fill line descends)
  const T_HOLD = 360;    // fully covered; the theme is swapped at the start of this
  const T_DRAIN = 760;   // paint drains downward, revealing the new theme
  const TOTAL = T_POUR + T_HOLD + T_DRAIN;
  const COVER_AT = T_POUR; // ms at which onCovered fires (screen opaque)

  // ---- tunables (shader uniforms) — tweak the look here --------------------
  const CFG = {
    simScale: 0.34,        // sim resolution as a fraction of canvas px (perf vs detail)
    simSteps: 2,           // sim sub-steps per frame (stability / flow speed)
    maxDpr: 1.5,

    gravity: 0.85,         // downward advection speed scale (drip/flow speed)
    viscosity: 0.12,       // anisotropic diffusion (drip rounding / smoothing)
    pourRate: 7.0,         // top-source inflow strength
    streamFreq: 9.0,       // number of pour streams across the width
    maxThick: 1.4,         // clamp on thickness
    drainClear: 0.82,      // per-step thinning of revealed paint during drain

    deep: [0.62, 0.02, 0.03],      // opaque thick-paint colour (vivid glossy red, per paint.png)
    spec: [1.0, 0.85, 0.85],       // specular highlight colour
    specPower: 60.0,               // highlight tightness (higher = sharper/wetter)
    absorb: 4.2,                   // Beer–Lambert k (how fast it becomes opaque with h)
    normal: 2.4,                   // normal exaggeration (relief strength)
    refract: 0.10,                 // backdrop refraction amount at the wet edges
    edge: 0.10,                    // alpha feather at the thin leading edge
    light: [-0.35, 0.5, 0.8],      // directional light
    rim: [0.5, 0.1, 0.16],         // Fresnel rim tint
    seed: 11.0,
  };

  const VERT = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;     // y up (0 = bottom, 1 = top) — matches GL texture rows
      gl_Position = vec4(aPos, 0.0, 1.0);
    }`;

  // --- simulation update: advect down, diffuse, pour at top, coverage floor, drain ---
  const SIM_FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uPrev;
    uniform vec2 uTexel;
    uniform float uGravity, uVisc, uPour, uPourRate, uStreamFreq, uMaxThick, uDrainClear;
    uniform float uFloorLo, uFloorHi, uClearAbove, uSeed, uTime;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
    float noise(vec2 p){
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    void main(){
      vec2 uv = vUv;
      float h = texture2D(uPrev, uv).r;

      // gravity advection (semi-Lagrangian): paint flows toward y=0; material arriving
      // here came from above (higher y). Speed grows with thickness (~h²) — the
      // lubrication flux that drives drip fingering.
      float speed = uGravity * (0.0016 + 0.010 * h * h);
      h = texture2D(uPrev, uv + vec2(0.0, speed)).r;

      // anisotropic diffusion — rounds drips, more vertical than horizontal
      float l = texture2D(uPrev, uv + vec2(-uTexel.x, 0.0)).r;
      float r = texture2D(uPrev, uv + vec2( uTexel.x, 0.0)).r;
      float u = texture2D(uPrev, uv + vec2(0.0, -uTexel.y)).r;
      float d = texture2D(uPrev, uv + vec2(0.0,  uTexel.y)).r;
      h += uVisc * ((l + r) * 0.2 + (u + d) * 0.3 - h);

      // pour source near the top (y≈1), broken into uneven streams to seed fingering
      float top = smoothstep(0.88, 1.0, uv.y);
      float streams = 0.45 + 0.55 * noise(vec2(uv.x * uStreamFreq, uTime * 1.7));
      h += uPour * uPourRate * top * streams * 0.0026;

      // coverage floor band [lo, hi] — guarantees opacity for the hidden theme swap,
      // and recedes during drain so the new theme is revealed top-first.
      float floorH = step(uFloorLo, uv.y) * step(uv.y, uFloorHi);
      h = max(h, floorH * 0.95);

      // during drain, thin the revealed paint (above the band) so the theme shows through
      h *= mix(1.0, uDrainClear, step(uClearAbove, uv.y));

      gl_FragColor = vec4(clamp(h, 0.0, uMaxThick), 0.0, 0.0, 1.0);
    }`;

  // --- render: wet shading of the thickness field ---
  const RENDER_FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uSim;
    uniform vec2 uTexel;
    uniform float uNorm, uRefract, uSpecPow, uAbsorb, uEdge;
    uniform vec3 uDeep, uBgTop, uBgBot, uSpec, uLight, uRim;

    void main(){
      float h = texture2D(uSim, vUv).r;
      if (h <= 0.002) discard;

      float hl = texture2D(uSim, vUv + vec2(-uTexel.x, 0.0)).r;
      float hr = texture2D(uSim, vUv + vec2( uTexel.x, 0.0)).r;
      float hd = texture2D(uSim, vUv + vec2(0.0, -uTexel.y)).r;
      float hu = texture2D(uSim, vUv + vec2(0.0,  uTexel.y)).r;
      vec3 n = normalize(vec3((hl - hr) * uNorm, (hd - hu) * uNorm, 1.0));

      // refract the outgoing backdrop through the wet surface
      vec2 refr = vUv + n.xy * h * uRefract;
      vec3 bg = mix(uBgBot, uBgTop, clamp(refr.y, 0.0, 1.0));

      // Beer–Lambert: translucent tinted edge → opaque deep red where thick
      float a = 1.0 - exp(-uAbsorb * h);
      vec3 base = mix(bg, uDeep, a);

      vec3 L = normalize(uLight);
      float diff = clamp(dot(n, L), 0.0, 1.0);
      vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
      float spec = pow(clamp(dot(n, H), 0.0, 1.0), uSpecPow);
      float fres = pow(1.0 - n.z, 3.0);

      vec3 col = base * (0.45 + 0.6 * diff) + uSpec * spec + uRim * fres;
      gl_FragColor = vec4(col, smoothstep(0.0, uEdge, h));
    }`;

  let prefersReduced = false;
  try { prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) {}

  let busy = false;
  let gl = null, canvas = null, ready = false, failed = false;
  let simProg = null, renderProg = null, quad = null;
  let texA = null, texB = null, fboA = null, fboB = null, simW = 0, simH = 0;
  let texType = null;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(sh));
    return sh;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(p));
    p.u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); p.u[info.name] = gl.getUniformLocation(p, info.name); }
    return p;
  }

  function makeTarget(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, texType, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return ok ? { tex, fbo } : null;
  }

  function makeCanvas() {
    const c = document.createElement("canvas");
    c.setAttribute("aria-hidden", "true");
    const s = c.style;
    s.position = "fixed"; s.inset = "0"; s.width = "100vw"; s.height = "100vh";
    s.zIndex = "60"; s.pointerEvents = "none";
    return c;
  }

  function init() {
    if (ready) return true;
    if (failed) return false;
    try {
      canvas = makeCanvas();
      gl = canvas.getContext("webgl", { premultipliedAlpha: false, alpha: true, antialias: false, depth: false })
        || canvas.getContext("experimental-webgl");
      if (!gl) throw new Error("no webgl");

      // float (or half-float) render targets give smooth thickness/normals
      const hf = gl.getExtension("OES_texture_half_float");
      gl.getExtension("OES_texture_half_float_linear");
      gl.getExtension("OES_texture_float");
      gl.getExtension("OES_texture_float_linear");
      texType = hf ? hf.HALF_FLOAT_OES : gl.UNSIGNED_BYTE;

      simProg = program(VERT, SIM_FRAG);
      renderProg = program(VERT, RENDER_FRAG);

      quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

      gl.disable(gl.DEPTH_TEST);
      ready = true;
      return true;
    } catch (err) {
      console.warn("[AresiumPaint] WebGL init failed, CSS fallback:", err && err.message);
      failed = true; teardownGL();
      return false;
    }
  }

  function teardownGL() {
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    canvas = null; gl = null; ready = false;
  }

  function setupTargets() {
    const dpr = Math.min(CFG.maxDpr, window.devicePixelRatio || 1);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    simW = Math.max(64, Math.round(canvas.width * CFG.simScale));
    simH = Math.max(64, Math.round(canvas.height * CFG.simScale));

    fboA = makeTarget(simW, simH); fboB = makeTarget(simW, simH);
    if (!fboA || !fboB) {                 // half-float not renderable → byte fallback
      texType = gl.UNSIGNED_BYTE;
      fboA = makeTarget(simW, simH); fboB = makeTarget(simW, simH);
      if (!fboA || !fboB) return false;
    }
    texA = fboA.tex; texB = fboB.tex;
    for (const t of [fboA, fboB]) {       // clear both to empty
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, simW, simH);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  function bindQuad(prog) {
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  // read the current page background so the wet edges refract the outgoing theme
  function backdropColors() {
    const toRgb = (str) => {
      const m = /rgba?\(([^)]+)\)/.exec(str || "");
      if (!m) return [0.03, 0.035, 0.045];
      const p = m[1].split(",").map(Number);
      return [p[0] / 255, p[1] / 255, p[2] / 255];
    };
    let bg = "rgb(8,9,12)";
    try { bg = getComputedStyle(document.body).backgroundColor || bg; } catch (_) {}
    const c = toRgb(bg);
    return { top: c, bot: c.map((v) => v * 0.82) };
  }

  function runGL(onCovered, onDone) {
    document.body.appendChild(canvas);
    if (!setupTargets()) { teardownGL(); failed = true; runCSS(onCovered, onDone); return; }

    const bg = backdropColors();
    const start = performance.now();
    let covered = false;
    const texel = [1 / simW, 1 / simH];

    function simStep(time, phase, frac) {
      // floor band [lo,hi] in y-up space; pour fills top→down, drain reveals top→down
      let floorLo = 0, floorHi = 0, pour = 0, clearAbove = 2.0;
      if (phase === "pour") { floorLo = 1.0 - frac; floorHi = 1.0; pour = 1.0; }
      else if (phase === "hold") { floorLo = 0.0; floorHi = 1.0; pour = 0.0; }
      else { floorLo = 0.0; floorHi = 1.0 - frac; clearAbove = 1.0 - frac; } // drain

      gl.bindFramebuffer(gl.FRAMEBUFFER, fboB.fbo);
      gl.viewport(0, 0, simW, simH);
      bindQuad(simProg);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texA);
      const u = simProg.u;
      gl.uniform1i(u.uPrev, 0);
      gl.uniform2f(u.uTexel, texel[0], texel[1]);
      gl.uniform1f(u.uGravity, CFG.gravity);
      gl.uniform1f(u.uVisc, CFG.viscosity);
      gl.uniform1f(u.uPour, pour);
      gl.uniform1f(u.uPourRate, CFG.pourRate);
      gl.uniform1f(u.uStreamFreq, CFG.streamFreq);
      gl.uniform1f(u.uMaxThick, CFG.maxThick);
      gl.uniform1f(u.uDrainClear, CFG.drainClear);
      gl.uniform1f(u.uFloorLo, floorLo);
      gl.uniform1f(u.uFloorHi, floorHi);
      gl.uniform1f(u.uClearAbove, clearAbove);
      gl.uniform1f(u.uSeed, CFG.seed);
      gl.uniform1f(u.uTime, time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // ping-pong swap
      const tt = texA; texA = texB; texB = tt;
      const tf = fboA; fboA = fboB; fboB = tf;
    }

    function render() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      bindQuad(renderProg);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texA);
      const u = renderProg.u;
      gl.uniform1i(u.uSim, 0);
      gl.uniform2f(u.uTexel, texel[0], texel[1]);
      gl.uniform1f(u.uNorm, CFG.normal);
      gl.uniform1f(u.uRefract, CFG.refract);
      gl.uniform1f(u.uSpecPow, CFG.specPower);
      gl.uniform1f(u.uAbsorb, CFG.absorb);
      gl.uniform1f(u.uEdge, CFG.edge);
      gl.uniform3fv(u.uDeep, CFG.deep);
      gl.uniform3fv(u.uBgTop, bg.top);
      gl.uniform3fv(u.uBgBot, bg.bot);
      gl.uniform3fv(u.uSpec, CFG.spec);
      gl.uniform3fv(u.uLight, CFG.light);
      gl.uniform3fv(u.uRim, CFG.rim);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
    }

    function frame(now) {
      const t = now - start;
      let phase, frac;
      if (t < T_POUR) { phase = "pour"; frac = t / T_POUR; }
      else if (t < T_POUR + T_HOLD) { phase = "hold"; frac = 1; }
      else { phase = "drain"; frac = Math.min(1, (t - T_POUR - T_HOLD) / T_DRAIN); }

      try {
        for (let i = 0; i < CFG.simSteps; i++) simStep((now + i * 16) * 0.001, phase, frac);
        render();
      } catch (e) {
        console.warn("[AresiumPaint] GL frame error, falling back:", e && e.message);
        teardownGL(); failed = true; busy = false;
        runCSS(covered ? null : onCovered, onDone);
        return;
      }

      if (!covered && t >= COVER_AT) { covered = true; if (onCovered) onCovered(); }

      if (t < TOTAL) {
        requestAnimationFrame(frame);
      } else {
        teardownAfterRun();
        busy = false;
        if (onDone) onDone();
      }
    }
    requestAnimationFrame(frame);
  }

  function teardownAfterRun() {
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    // keep gl/programs warm for the next pour; drop the FBOs/textures
    for (const t of [fboA, fboB]) { if (t) { gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex); } }
    fboA = fboB = texA = texB = null;
  }

  // Photoreal path: play an alpha paint-pour clip as a transparent fullscreen overlay.
  // Swaps the theme at VIDEO.coverAt; on any load/playback failure (e.g. asset not yet
  // rendered → 404), calls fallback() so the sim/CSS takes over with no visible glitch.
  function runVideo(onCovered, onDone, fallback) {
    const v = document.createElement("video");
    v.muted = true; v.defaultMuted = true; v.playsInline = true;
    v.setAttribute("playsinline", ""); v.setAttribute("aria-hidden", "true"); v.preload = "auto";
    const s = v.style;
    s.position = "fixed"; s.inset = "0"; s.width = "100vw"; s.height = "100vh";
    s.objectFit = "cover"; s.zIndex = "60"; s.pointerEvents = "none"; s.background = "transparent";

    const addSrc = (src, type) => { const el = document.createElement("source"); el.src = src; el.type = type; v.appendChild(el); };
    if (VIDEO.webm) addSrc(VIDEO.webm, "video/webm");
    if (VIDEO.mov) addSrc(VIDEO.mov, 'video/quicktime; codecs="hvc1"');

    let settled = false, covered = false, coverTimer = null, loadTimer = null;
    const cleanup = () => { if (coverTimer) clearTimeout(coverTimer); if (loadTimer) clearTimeout(loadTimer); if (v.parentNode) v.parentNode.removeChild(v); };
    const fail = () => { if (settled) return; settled = true; cleanup(); fallback(); };

    v.addEventListener("error", fail);
    v.addEventListener("loadeddata", () => {
      if (settled) return;
      if (loadTimer) clearTimeout(loadTimer);
      v.play().then(() => {
        coverTimer = setTimeout(() => { covered = true; if (onCovered) onCovered(); }, VIDEO.coverAt * 1000);
      }).catch(fail);
    });
    v.addEventListener("ended", () => {
      if (settled) return; settled = true;
      if (!covered && onCovered) onCovered();
      cleanup(); busy = false; if (onDone) onDone();
    });
    // if nothing has loaded shortly, treat as missing and fall back
    loadTimer = setTimeout(() => { if (!settled && v.readyState < 2) fail(); }, 1500);

    document.body.appendChild(v);
    v.load();
  }

  // CSS-curtain fallback — the original `.paint` element + timings, built imperatively.
  function runCSS(onCovered, onDone) {
    const el = document.createElement("div");
    el.className = "paint"; el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    void el.offsetHeight;
    requestAnimationFrame(() => el.classList.add("go"));
    if (onCovered) setTimeout(onCovered, COVER_AT);
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
      busy = false;
      if (onDone) onDone();
    }, TOTAL);
  }

  window.AresiumPaint = {
    prewarm() { if (!prefersReduced) { try { init(); } catch (_) {} } },
    pour(opts) {
      opts = opts || {};
      if (busy) return;
      busy = true;
      if (prefersReduced) { runCSS(opts.onCovered, opts.onDone); return; }
      // prefer the photoreal video → GPU sim → CSS curtain
      const fallback = () => { if (init()) runGL(opts.onCovered, opts.onDone); else runCSS(opts.onCovered, opts.onDone); };
      if (VIDEO.enabled) runVideo(opts.onCovered, opts.onDone, fallback);
      else fallback();
    },
  };
})();
