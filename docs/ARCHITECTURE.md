# Architecture

## Overview

```
  VR Bank online banking ──export──▶ imports/*.xml (CAMT)  ┐
                                                           │   src/import/run.ts
  PayPal activity ─────────export──▶ imports/*.csv         ┘──▶ parse → dedup → upsert
                                                                      │
                                                                      ▼
                                                                 PostgreSQL (Prisma)
                                                                      │
                                                       src/sync/categorize.ts (rules)
                                                                      │
                                                                      ▼
                                            Next.js + Tremor dashboard   ◀── Phase 2
```

Everything is TypeScript against one Postgres database.

## Why import instead of an API

- **GoCardless Bank Account Data** (the free PSD2 aggregator) disabled new
  signups in mid-2025. Other aggregators (Enable Banking, Tink, finAPI) require a
  commercial contract + company KYB — not viable for a personal project.
- **PayPal Transaction Search** requires a *business* account, and a fresh
  business account only sees its own transactions, not your personal history.

File export sidesteps all of it: no signup, no business account, no 90-day
reconsent. The tradeoff is it's semi-manual (you export periodically).

## Components

| Path | Role |
|------|------|
| `prisma/schema.prisma` | Data model: `Account`, `Transaction`, `Category`, `CategoryRule`. |
| `src/import/camt.ts` | Parses CAMT.052/053 XML (VR Bank) → normalised transactions. |
| `src/import/paypal-csv.ts` | Parses PayPal CSV (EN/DE locales) → normalised transactions. |
| `src/import/run.ts` | Scans `imports/`, dedups, upserts, then categorises. The entry point. |
| `src/sync/categorize.ts` | Applies `CategoryRule`s to uncategorised transactions. |
| `src/lib/db.ts` | Shared Prisma client. |
| `scripts/seed-categories.ts` | Starter categories + German-merchant rules. |

## Key design decisions

- **Idempotent import.** Each transaction is unique on `(source, externalId)`.
  CAMT uses the bank's reference (or a content hash when none is provided); PayPal
  uses its Transaction ID. Re-importing overlapping ranges adds only new rows.
- **Signed amounts.** `amount` negative = money out, positive = in. CAMT sign
  comes from `CdtDbtInd`; PayPal from the signed `Net`/`Netto` column.
- **Raw payload kept.** The provider's original record is stored in `raw` for
  re-deriving fields later without re-importing.
- **Layered categorisation.** Today: fast substring rules. Later: a Claude
  fallback for the leftovers, then learning from manual fixes (see `ROADMAP.md`).

## Running on the Hetzner server

The server is the always-on host for the database + (Phase 2) the dashboard.

1. Install Docker + Compose, clone the repo, create `.env`.
2. `docker compose up -d db && npm run db:push && npm run seed`.
3. Import: you can run `npm run import` against files you `scp` into `imports/`,
   or just point the future dashboard's upload button at it.

Imports are manual by nature, so there's no cron for Phase 1. If/when FinTS is
added, the bank sync becomes a scheduled job like in
[FlatSniper]; PayPal stays import-only.

## Dev portability (Windows → macOS → Hetzner)

Postgres runs in Docker, so the DB is identical everywhere. Node code is
OS-agnostic. Moving to the MacBook is just `git clone && npm install`; the Mac is
closer to the Linux server than Windows is.
