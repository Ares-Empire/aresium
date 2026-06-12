# Design notes & backlog

Deferred design work and the reasoning behind it. Picked up after the layout
overhaul (#3) lands, since that changes the Aresium (red) screen anyway.

## 1. Real "poured paint" transition (red / Aresium mode) — ✅ built (procedural WebGL)

**Implemented in `web/public/app/paint.js`** (`window.AresiumPaint`): a self-contained
WebGL canvas overlay that slides a *lit, wet, drippy* red paint sheet top→bottom through
the viewport. Finite-difference surface normals drive a directional diffuse term + a
tight Blinn-Phong specular (the wet gloss); the red deepens with paint thickness; the
leading/trailing edges break into rounded drip tendrils; a sheen band travels down the
fresh paint. `app.jsx`/`mobile.jsx` call `AresiumPaint.pour({onCovered, onDone})` — the
theme swaps at `onCovered` (screen fully covered), revealed as the sheet leaves. Falls
back to the original CSS curtain when WebGL is unavailable or `prefers-reduced-motion`.

**Chosen approach vs. the original plan:** procedural/analytic surface rather than a full
GPU height-field fluid sim (ping-pong FBOs, advection, surface tension). The look is the
goal, and the procedural route is deterministic, dependency-free, and robust across
devices/contexts without float-texture support. Tunables live in `CFG` at the top of
`paint.js` (colours, drip growth, normal/specular strength, light dir) for visual tuning.
A full fluid sim remains a possible upgrade if the procedural surface isn't convincing
enough — the original design is kept below for reference.

**Original state (replaced):** a CSS curtain — a red-gradient panel that slides
top→bottom, with an SVG turbulence/displacement/goo filter warping its leading edge
(`.paint` in `web/public/index.html`, now the fallback). Read as a *warped sheet sliding
down*, not as paint. No real body, flow, or lighting.

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
- **Tabs are too bright** — DONE in #3 (dark red glass).

## 3. Phone (mobile) version — *different functionality, not a reflow* — ✅ built

Implemented in `web/public/app/mobile.jsx` (`window.MobileApp`); `app.jsx`'s `Root`
swaps `App`↔`MobileApp` via `matchMedia("(max-width: 620px)")`. Reuses the data layer,
`AnimatedChart`, the panel lists, and `TxnDetailModal`. Original plan below for reference.

The desktop view doesn't shrink well; phone gets its own component tree + flow.
Feasible with the current zero-build setup: render a separate `MobileApp` for
narrow screens; both share the same data layer (`window.AresiumData`), the chart
(`AnimatedChart`), and the detail/recategorise modal (`TxnDetailModal`).

**Device routing (the iPad question):** pick by viewport width via `matchMedia`,
re-evaluated on resize/orientation.
- Phones (`max-width: ~620px`) → **MobileApp**.
- **iPad** (portrait ~768, landscape ~1024) is above the breakpoint → gets the
  **web version** (it has the screen for it). A tablet-tuned third variant is a
  later option if wanted.

**Start screen:**
- Default = **current month, Expenses** ("current" = latest month with data).
- Category list sits **embedded on the wall** (no elevated cards), like the web graph.
- Two controls slightly above the list:
  1. **Current / Overview** segmented toggle (default Current; Overview = all-time).
  2. **Graph icon** toggle — when on, a chart smoothly reveals (height/opacity), showing
     the current/overview series for the active side.
- **Swipe left/right** switches Expenses ↔ Income: the active category list slides
  out and the other slides in (embedded, smooth). Swipe handler via touch/pointer
  events + transform transition.
- **Bottom: the big ARESIUM** word, always (red/dark/white).

**Drill:** tap a category → **months list with sums**; if the **graph toggle is on**,
show that category's **over-time graph** instead. Tap category → month (graph off) →
**individual activities** → tap one → detail modal (reuse, incl. recategorise).

**Mobile state machine:** `{ screen: start|category|categoryMonth, side: expenses|income,
range: current|overview, monthKey, cat, graphOn }`.

**Build order (next session):** (1) matchMedia root that swaps App↔MobileApp on the
breakpoint; (2) MobileApp shell + state; (3) start screen (toggles + swipeable
embedded list + ARESIUM band + graph reveal); (4) drill screens (months / over-time
graph / activities) reusing the modal; (5) mobile CSS. Reuse data layer + chart + modal.

## 4. Custom login screen (replaces nginx basic-auth) — ✅ in-app auth built

**Built (app side):** single password + a stateless, HMAC-signed session cookie (30-day),
zero deps (Node crypto: scrypt for the password, HMAC-SHA256 for the cookie).
- `src/web/auth.ts` — hashing, cookie issue/verify, `authEnabled()`.
- `src/web/login-page.ts` — branded `/login` page (self-contained, no external assets).
- `src/web/server.ts` — `GET/POST /login`, `/logout`, and a gate on every other route
  (browser → 303 `/login`; `/api/*` → 401). Cookie is HttpOnly + Secure + SameSite=Lax.
- `scripts/set-password.ts` (`npm run set-password`) — writes `AUTH_PASSWORD_HASH` +
  generates `AUTH_SESSION_SECRET` into `.env`.

**Safety design:** the gate is enforced ONLY when both env vars are set. Until then the
server logs through unchanged — so deploying the code can't lock anyone out, and nginx
basic-auth keeps protecting the app in the meantime. Tested end-to-end (unauth redirect,
401 on API, wrong-password 401, valid/tampered/expired cookie, logout).

**Rollout (no exposure window — do in this order):**
1. `npm run set-password` → set the password (hash + secret land in `.env`).
2. `systemctl restart aresium` → the gate activates.
3. Visit the site (still behind basic-auth) and confirm the in-app login works.
4. ONLY THEN remove `auth_basic` (+ `auth_basic_user_file`) from the aresium server
   block in the shared `insureai_nginx` vhost and reload nginx. Now the in-app login is
   the sole gate. (This nginx edit is on shared infra — done by the operator, not in repo.)

Optional follow-ups: a logout button in the UI (route exists at `/logout`); DB-backed
sessions if instant global revocation is ever wanted.
