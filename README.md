# aresium

A self-hosted personal finance tracker for a **VR Bank** account + **PayPal**.
Imports your transactions, categorises them, and (soon) shows expenses over time
and per-category graphs in a modern web dashboard.

Your financial data lives only on hardware you control (local + your Hetzner box) —
no third-party finance SaaS.

## Why file import?

GoCardless (the free PSD2 API) stopped accepting new users in mid-2025, and
PayPal's Transaction Search API needs a *business* account that wouldn't even see
your personal history. So aresium ingests **file exports** instead: VR Bank **CAMT
(.xml)** and PayPal **CSV** — no signups, no business account, no 90-day reconsent.
Fully automatic bank sync via **FinTS** can be added later (see `docs/ROADMAP.md`).

## Status

🟢 **Phase 1 — ingestion** (now): CAMT + PayPal CSV import into Postgres + rule-based categorisation.
🟡 **Phase 2 — dashboard**: Next.js + Tremor charts. Not built yet.

## Tech stack

- **TypeScript** everywhere
- **PostgreSQL** + **Prisma**
- File parsers: `fast-xml-parser` (CAMT), `csv-parse` (PayPal)
- **Docker Compose** for Postgres — identical on Windows, macOS, and Hetzner
- **Next.js + Tremor** dashboard (Phase 2)

## Quick start

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

Full export walkthrough: [`docs/SETUP-IMPORT.md`](docs/SETUP-IMPORT.md).
Design + Hetzner notes: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
Plan: [`docs/ROADMAP.md`](docs/ROADMAP.md).
