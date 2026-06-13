# Investments integration — Arestoteles (the Ares Empire)

Aresium is the first of several self-hosted "Ares" tools. The second, **Arestoteles**, is an
AI-run stock portfolio manager (separate repo, Python, same Hetzner host). This doc is the
**Aresium side** of connecting them. The full contract + Arestoteles-side plan live in the
Arestoteles repo: `docs/09-aresium-integration.md` and `docs/11-web-frontend.md`.

## The decision (so future sessions don't relitigate it)

- **Arestoteles is its own site**, at its **own domain `arestoteles.de`**, in the **same design
  language as Aresium** (the "Ares Empire": shared tokens, fonts, on-the-wall charts, wordmark band,
  a dropping intro). It is **not** a page rendered inside Aresium.
- A **central Ares manager/hub** (adopted direction) is the empire's home — a launcher to each app
  and the future SSO provider.
- **Aresium hosts a compact Investments overview card** that deep-links into the Arestoteles site.
  That keeps the "everything in one place" feel without owning Arestoteles' rich UI.
- Data flows over a **read-only REST API** from Arestoteles (no shared DB). Aresium fetches it
  **server-side** so the bearer token never reaches the browser.

## What to build in Aresium (later — not yet built)

1. **Env + client.** `ARESTOTELES_URL` + `ARESIUM_API_TOKEN` in `.env`; a thin typed client in
   `src/` that calls the Arestoteles API server-side (same place `getDashboardData()` lives). Aresium
   can generate its TS types from Arestoteles' OpenAPI schema (single source of truth).
2. **Investments overview card** on the overview screen — a glass `side-card` in the existing
   language showing: NAV, **today's P&L** + **since-inception P&L** (green `#34E27A` / red
   `var(--exp)`), a benchmark sparkline (SOXX), top-N positions, a **paper/live** chip, and a button
   that opens `arestoteles.de`. Pulls `/portfolio` + `/positions` (5-min cache, fetch on load).
   Until the brain trades (Arestoteles Phase 2) it shows a clean empty/paper state.
3. **Ares switcher / hub link** — in the header, to the central Ares manager and sibling apps.
   **Do not repurpose the top-left brand button** — single-click there stays the red "Ares mode"
   intro. Add the switcher alongside it.

## Cross-app login (SSO) — the empire login

Aresium's auth is an HMAC-signed session cookie (`src/web/auth.ts`, `AUTH_SESSION_SECRET`,
HttpOnly+Secure+SameSite=Lax). `aresium.de` and `arestoteles.de` are **separate registrable
domains**, so a shared parent-domain cookie can't span them. SSO instead routes through the
**central Ares manager as the identity provider**: sign in once at the hub, which mints a
short-lived signed token each app exchanges (on redirect) for its own session cookie. Until the hub
exists, each app keeps its **own independent login** (Arestoteles ports Aresium's scrypt+HMAC
pattern).

## Deploy note (shared infra)

Arestoteles' subdomain needs a DNS record + an additive `arestoteles.conf` in the shared
`insureai_nginx` `conf.d` + a cert via the shared certbot — the **same pattern and gotchas as the
existing `aresium.conf`** (musl `$2b$` bcrypt if basic-auth is used, `conf.d` perms, the
`ufw allow from 172.18.0.0/16` rule for the docker-gateway bind, SIGHUP reload). See the operator's
`aresium-deploy` notes.
