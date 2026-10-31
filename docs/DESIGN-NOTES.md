# Design notes & backlog

Deferred design work and the reasoning behind it. Picked up after the layout
overhaul (#3) lands, since that changes the Aresium (red) screen anyway.

## 1. Red / Aresium-mode transition

**Active transition: the wordmark intro** (`web/public/app/aresium-intro.js`,
`window.AresiumIntro`). On the Aresium/red toggle the big ARESIUM wordmark flies up from
below to a centred hero, vibrates as it lands, then settles into the bottom band while the
background morphs between themes — and the mirror when leaving red. Self-contained overlay
(morphing bg layer + a copy of the band word) animated with the Web Animations API; the real
`.aresium-band` is hidden (`.ares-intro-running`) for the duration and the theme is swapped
(`onSwap`) while the page is covered, so the overlay hands off to the real band seamlessly.
Tunables in `CFG` (timeline, hero offset/scale, swap point). Both `app.jsx` and `mobile.jsx`
call it from their red toggles.

The earlier poured-paint transition (GPU fluid sim, Blender-rendered video) was removed on 2026-10-23;
it is in the git history if ever needed.

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

## 4. Login — Empire accounts (since 2026-10-23)

The single password is gone. Aresium uses **Empire accounts** (PocketBase at
auth.ares-empire.de; see ares-empire `docs/ACCOUNTS.md`).
- `src/web/empire-auth.ts` — login against the Empire, and the token check: approved, has the
  `aresium` service, and listed in `EMPIRE_ALLOWED_USERS` (Aresium still holds one person's
  data). Re-checked with the Empire every minute, so un-approving someone locks them out.
- `src/web/auth.ts` — the session cookie (HttpOnly, Secure, SameSite=Lax, 30 days) holds the token.
- `src/web/login-page.ts` — `/login` (start screen: *Log in* button + sign-up link) and
  `/login/email` (email + password). Sign-up and password reset live on the hub.
- `src/web/contact-page.ts` — `/contact` (English) and `/kontakt` (German), open to everyone: Aresium's contact form,
  also where visitors ask for the iPhone app (`?topic=access`, linked from the front page and the demo as `GET_APP`
  in `src/web/links.ts`). Its look mirrors the iPhone app's Contact & support. It is dark until the website is switched
  to light (`web/public/app/appearance.js` remembers the choice), and its words address no one (no you/du).
  The browser posts straight to the account server's `contact` collection (ares-empire `docs/ACCOUNTS.md` → Website
  contact form); `web/public/forms/contact-form.js` sends it and knows no app or language (data attributes on the
  page), `web/public/forms/contact.css` is the look. The page sends its own Content-Security-Policy (`CONTACT_CSP`):
  this server, plus `connect-src https://auth.ares-empire.de`.
- `src/web/server.ts` — `POST /login`, `/logout`, `POST /sso` (the hub hands over the token,
  so coming from the hub needs no second login), and the gate: pages need the cookie; `/api/*`
  also accepts `Authorization: Bearer <token>` (iPhone app).
- If the accounts server is down, nobody gets in (deny, never open).
