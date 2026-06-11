# Design notes & backlog

Deferred design work and the reasoning behind it. Picked up after the layout
overhaul (#3) lands, since that changes the Aresium (red) screen anyway.

## 1. Real "poured paint" transition (red / Aresium mode)

**Current state:** a CSS curtain — a red-gradient panel that slides top→bottom,
with an SVG turbulence/displacement/goo filter warping its leading edge
(`.paint` in `web/public/index.html`). Honest assessment: it reads as a *warped
sheet sliding down*, not as paint. No real body, flow, or lighting.

**The goal:** it should look like a bucket of rich red paint is actually poured
over the screen and **flows down** — 3D body, viscous/smooth motion, drip
tendrils, and **lighting/specular that matches** (wet, glossy surface).

**Why CSS can't do it:** CSS filters distort a static shape; they can't simulate
fluid that accumulates, flows around, pools, and drips with thickness + light.
That needs a per-frame simulation on the GPU.

**The actual approach (WebGL, no npm deps — a single self-contained canvas
overlay triggered on red-mode toggle):**
- **Height-field fluid sim** in a fragment shader: a paint "thickness" field that
  is poured in at the top and advected downward under gravity + viscosity, with
  surface tension so edges form rounded lips and tendrils (drips).
- **3D / lighting:** derive a normal map from the height field; apply directional
  light + specular for the wet, glossy look; tint with the rich red.
- **Smoothness:** simulate at a modest resolution, render full-res; ~1–2 s pour,
  then hold/recede. Pre-warm the GL context so the first run isn't janky.
- **Alternatives considered:** (a) a pre-rendered alpha video of a real paint
  pour — most photoreal, but a heavy asset and the colour is baked in; (b) a
  Lottie/AE animation — lighter but still not interactive/lit. The shader route
  keeps it dependency-free and theme-tintable.
- **Effort:** a few focused hours; isolate as one `paint.js` canvas module so it
  can't affect the rest of the app. Respect `prefers-reduced-motion`.

## 2. Aresium (red) mode polish

- **Richer/darker base** — the deep oxblood is close; can go a touch darker/richer still.
- **Tabs are too bright** — in red mode the panel/tab cards use near-white glass
  (`--card`/`--card-2` = `rgba(255,255,255,0.1x)`); they should be **less white,
  tinted toward the background** (dark red glass) so they sit in the scene rather
  than glowing. Handle as part of the #3 tab restyle.
