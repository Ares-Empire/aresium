# 01: Dashboard calculations move to the server (`/api/data` version 2)

Status: draft
Branch: `codex/01-server-calc` · Worktree: `../aresium-01-server-calc` · Model: `gpt-6.1-sol`, effort `high`

## Goal

`GET /api/data` returns the dashboard numbers ready-made (version 2, `docs/API-DATA.md`) instead of raw
transactions that the browser aggregates. The website then only looks up and displays, and the coming
iPhone app reads the same numbers. **Every number the website shows must stay exactly the same.**

## Read first

- `docs/API-DATA.md`: the contract. Build exactly this shape.
- `web/public/app/data.js`: `buildAresiumData` is the reference. Its results define what is correct.
- `src/data/queries.ts` → `getDashboardData()` (builds the version 1 source), `src/web/server.ts` → `/api/data`.
- `web/public/app/app.jsx` (`onTxnRecategorized`, `refresh`), `web/public/app/mobile.jsx`, `web/public/app/panels.jsx`
  (how the UI reads `window.AresiumData`), `web/public/app/data.mock.js`, `web/public/index.html` (script tags).

## Build

1. **`src/data/dashboard.ts`**: a pure function `buildDashboard(source): Dashboard`, with exported types matching
   `docs/API-DATA.md`. `source` is what `getDashboardData()` returns today. No Prisma or other I/O in this file.
   Compute everything in **one pass over the transactions**, adding amounts per bucket **in transaction order**
   (the same order of additions as the old code, so floating-point sums come out identical), and round with
   the same `Math.round(n * 100) / 100`.
2. **`src/data/queries.ts`**: rename `getDashboardData` to `getDashboardSource` (logic unchanged).
   **`src/web/server.ts`**: `/api/data` returns `buildDashboard(await getDashboardSource())`.
3. **`web/public/app/data.js`**: replace `buildAresiumData` with an adapter from version 2 that exposes **the
   same `window.AresiumData` interface**: every key the old function returned, with the same return shapes
   (category rows as `{...category, total}`, month lists as `{...month, total}`, transactions with `day` and
   `tagged`, the same sort orders, the same fallbacks such as `incomeBucketMeta` for an unknown name). So
   `app.jsx`, `mobile.jsx` and `panels.jsx` keep working unchanged, with one exception: after a recategorise or
   tag change, `app.jsx` (and anything else that patches `window.AresiumData.transactions` in place) calls
   `await window.AresiumData.refresh()` instead of patching, then bumps its version as today.
4. **Sample data** (replaces `data.mock.js`): move the seeded generator from `data.mock.js` into
   `src/data/sample-source.ts` (same seed, same output). `scripts/build-sample.ts` runs it through
   `buildDashboard` and writes `web/public/app/dashboard.sample.json` (for the iPhone app's tests and previews)
   and `web/public/app/dashboard.sample.js` (`window.AresiumSample = {...}`, so the website still opens from
   `file://` with no server). `data.js` falls back to `window.AresiumSample`. Delete `data.mock.js` and its script
   tag; add the new script tag. npm script: `"sample": "tsx scripts/build-sample.ts"`.
5. **Equivalence check** `scripts/check-dashboard.ts`: copy today's `web/public/app/data.js` unchanged to
   `scripts/legacy/data-v1.js` first. The check loads the old file and the new adapter with `node:vm`, feeds the
   old one the version 1 source and the new one `buildDashboard(source)`, then calls **every** key of the old
   interface with **every** argument: each month key, `null` where the function accepts it, each category
   name and each income bucket name that occurs; plus the plain values (`months`, `categories`, `catByName`,
   the three `overview*` arrays). Compare with exact deep equality (no tolerance). Print how many values were
   compared, the first 20 mismatches, the time `buildDashboard` took, and the JSON size of version 1 vs 2.
   Exit 1 on any mismatch. Source: `--sample` (the generator) or `--db` (`getDashboardSource()`, read-only,
   imported dynamically only in this mode so `--sample` needs no database).
6. **Tests** with Node's built-in runner (`"test": "tsx --test src/**/*.test.ts"` or equivalent that works):
   `src/data/dashboard.test.ts` with a small hand-made source and known answers for: a tagged spend txn
   (listed in two categories, counted once in `expense`), a refund in a spend category (`Refunds` bucket, spend
   series clamped at 0), an uncategorised payment in (`Other`), a transfer, balance carried forward on a day
   without bookings, and a partial current month.

## Settled: do not re-open

- Version 2 replaces version 1 outright. The only client today is the website, which changes in this same
  branch; there is no installed app yet.
- The adapter keeps the old `window.AresiumData` interface so the UI files stay untouched (apart from the
  recategorise refresh). Changing the UI is a later step.
- Exact equality with the old results, not "close enough".
- No new dependencies (`tsx` and `typescript` are already there).

## Out of scope

- UI layout or styling; the Telegram bot's own queries (`getOverview`, `getMonth`); import; auth.
- `.env`, `config/personal.json`, `prisma/` schema. Nothing writes to the database.

## Rules (no sandbox: these are rules, not walls)

Work only inside the worktree. Never commit, push, or change git config (Claude commits). Install nothing
(dependencies are already installed in the worktree). No network. No secrets, real transactions or personal
data in files; the sample generator's made-up data is fine.

## Done when

- `npm test` passes with the new tests.
- `npx tsx scripts/check-dashboard.ts --sample` reports 0 mismatches over all compared values.
- `npm run sample` writes both sample files; the website's file fallback uses them.
- `npx tsc --noEmit`: report whether it passes. If it already failed before your change (check first with
  `git stash`-free means, e.g. on a copy), say so and do not fix unrelated errors.

## Final message

Short and factual: files changed; the exact commands you ran with their summary lines (tests, compared
values, mismatches, `buildDashboard` time, payload sizes); anything you could not do or doubt about the brief.
Report only what you saw.
