# Roadmap

## Phase 1 — Ingestion ✅ (current)

- [x] Project + Docker Postgres + Prisma schema
- [x] CAMT (.xml) parser for VR Bank
- [x] PayPal CSV parser (EN/DE locales)
- [x] Idempotent import into Postgres (`npm run import`)
- [x] Rule-based categorisation + starter German categories
- [ ] **You:** export VR Bank (CAMT) + PayPal (CSV), drop in `imports/`, run import
- [ ] Verify the data + tune categories (send me a PayPal header if columns differ)

## Phase 2 — Dashboard

The modern, stylish part. **Next.js + Tailwind + shadcn/ui + Tremor**.

- [ ] Total expenses **over time** (area chart, monthly/weekly toggle)
- [ ] **Per-category** breakdown (donut) + a graph per category over time
- [ ] Income vs. expense + savings rate
- [ ] Transaction table: search, filter, manually re-categorise
- [ ] Account balances + combined net worth over time
- [x] **Upload button** in the UI that runs the importer (no terminal needed) — desktop
      header + phone controls; POST /api/import → live morph to new totals
- [ ] Deploy to Hetzner behind your domain (HTTPS via Caddy/Traefik)

## Phase 3 — Smart features

- [ ] **LLM categorisation fallback** (Claude) for transactions no rule matches
- [ ] **Learn from manual fixes** — recategorising suggests a new rule
- [ ] **Recurring / subscription detection** + price-change alerts
- [ ] **Budgets per category** with "80% used" warnings
- [ ] **Forecast** end-of-month balance from recurring items
- [ ] **Anomaly flags** — unusually large spend for a category
- [ ] **Telegram weekly summary** (reuse your existing bot setup)

## Phase 4 — Automation / ops

- [ ] **FinTS** auto-sync for the bank (direct to VR Bank, no third party; periodic TAN)
- [ ] Backups of the Postgres volume
- [ ] Multi-currency display conversion

---

### Ideas parking lot

Savings goals · tax-relevant export · shared/split expenses · mobile-friendly PWA.
