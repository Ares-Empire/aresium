# Developing Aresium

Notes for working on the server and the engine. The overview is in the [README](../README.md); the rules for
coding agents are in [AGENTS.md](../AGENTS.md).

## Why file import?

GoCardless (the free PSD2 API) stopped accepting new users in mid-2025, and
PayPal's Transaction Search API needs a *business* account that wouldn't even see
your personal history. So aresium ingests **file exports** instead: VR Bank **CAMT
(.xml)** and PayPal **CSV** — no signups, no business account, no 90-day reconsent.
Fully automatic bank sync via **FinTS** is an option for later (see `docs/ROADMAP.md`).

## Local setup, step by step

```bash
# prerequisites: Node 20+, Docker Desktop running
npm install
cp .env.example .env          # DATABASE_URL is already set for local Docker

npm run db:up                 # start Postgres
npm run db:push               # create tables
npm run seed                  # starter categories + matching rules

# export your data and drop the files into imports/  (see docs/SETUP-IMPORT.md)
#   VR Bank  -> CAMT .xml
#   PayPal   -> CSV
npm run import                # load + categorise everything in imports/

npm run db:studio             # browse the data
```

Full export walkthrough: [`docs/SETUP-IMPORT.md`](SETUP-IMPORT.md).
Design notes: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).
Plan: [`docs/ROADMAP.md`](ROADMAP.md).

The optional [German local places experiment](../data/local-places/README.md) derives a separately loaded database
from OpenStreetMap via Geofabrik: © OpenStreetMap contributors, ODbL. Its README records sources, rebuilds,
measurements and redistribution notices. It is off by default and is not part of the app bundle.

## Dashboard API and languages

The current dashboard is served by `npm run web` (`src/web/server.ts`, static files in `web/public`).
The dashboard and API support English and German via the language button and `Accept-Language`.
The contact form has dedicated language routes (`/contact` English, `/kontakt` German, open to everyone: `src/web/contact-page.ts`;
"Get the app" is `/contact?topic=access`). See [the API contract](API-DATA.md#language), the wording in `src/lib/texts.ts`, and
[deployment steps](../deploy/README.md). Run `npm ci`, `npm test` and `npm run typecheck` before deploying.

## Brief 218: local demo, without a database

`npm ci`, `npx prisma generate`, `npm run sample`, then create an **invented** owner record in `build/218-owner.json`:
`{"name":"Example Owner","street":"Example Street 1","city":"Example City","email":"owner@example.org"}`.
Run `ARES_OWNER_FILE="$PWD/build/218-owner.json" HOST=127.0.0.1 PORT=5188 npm run web` and open
`http://127.0.0.1:5188/demo` (or `/demo?tour=1`). This path reads only generated invented data, needs no
login/database and refuses writes locally. The language button switches English/German; display preferences
stay in this browser. Both desktop and phone widths use the server-generated sample calculations.

The new authenticated routes require `prisma/migrations/20261103100000_web_parity/migration.sql` on deployment.
Do **not** apply it during this coding brief. It adds category metadata, `WebSettings` and the latest `WebUndo`.
They are included in the existing whole-database backup; no second storage location was added. Bank readers,
sorting rules and stable import ids are unchanged. See [API-DATA.md](API-DATA.md) for all additive fields/routes.

This repository previously used `db push` and had no migration history. The new migration directory therefore
also includes `20261103090000_baseline`, generated from the unchanged pre-218 schema. **Claude on the server:**
after verifying the existing schema matches that baseline, mark it applied with
`npx prisma migrate resolve --applied 20261103090000_baseline`, then run `npx prisma migrate deploy` and
`npx prisma generate`. A fresh empty development database instead runs both migrations with `migrate deploy`.
No database commands were executed during this brief; `migrate diff --from-empty` used schema files only.

Visual QA is reproducible with `node --import tsx scripts/check-web-parity.mjs`. It uses an already installed
Playwright and Chromium, or the `PLAYWRIGHT_MODULE` / `CHROMIUM_EXECUTABLE` paths; it installs nothing.
Screenshots and the report go to `build/218-*`. Set `ARESIUM_DEMO_URL` for another port.

The shared feature pages and styles are loaded by `web/public/index.html` for the live dashboard and `/demo`.
They are named for fixed costs, paybacks, names, days, selection, quick sort, categories, cash and empty state;
`page-helpers.jsx` and `page-navigation.jsx` hold the common page infrastructure. The browser check also captures
scrolled Ended/category-settings views and checks custom ticks, separators and action alignment.
