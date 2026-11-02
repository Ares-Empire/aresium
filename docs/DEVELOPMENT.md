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
API text for the iPhone app supports English and German via `Accept-Language`; the website stays
English, except the contact form (`/contact` English, `/kontakt` German, open to everyone: `src/web/contact-page.ts`;
"Get the app" is `/contact?topic=access`). See [the API contract](API-DATA.md#language), the wording in `src/lib/texts.ts`, and
[deployment steps](../deploy/README.md). Run `npm ci`, `npm test` and `npm run typecheck` before deploying.
