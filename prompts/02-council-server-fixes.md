# 02: Server fixes from the pre-TestFlight council

Status: draft
Branch: `codex/02-council-server` · Worktree: `../aresium-02-council-server` · Model: `gpt-6.1-sol`, effort `high`

## Goal

Four fixes the council accepted (`~/empire-ios/docs/reviews/2026-10-23-pre-testflight.md`, S1–S4), so the
iPhone app and the website can rely on the server's answers. Nothing visible changes for a logged-in user.

## Read first

- `docs/API-DATA.md`, above all the new **Auth** table (401 / 403 / 503) and `pick`.
- `src/web/empire-auth.ts`, `src/web/server.ts` (auth gate, `readBody`, `/api/import`), `src/web/auth.ts`,
  `src/data/queries.ts` (`CAT_META`, `getDashboardSource`), `src/data/dashboard.ts` (`pick`), `src/data/dashboard.test.ts`.

## Build

1. **S1 Auth outcomes.** `empire-auth.ts` returns three outcomes instead of a boolean: allowed, denied (with the
   status 401 or 403 per the table) and unavailable (PocketBase unreachable, timeout, 429, 5xx). Cache allowed
   and denied answers as now; never cache "unavailable". `server.ts`: every `/api/*` route answers per the table
   with `{error}`. Pages (non-API): denied → the login page as now; unavailable → a short "Login service
   unavailable, try again in a minute" page with status 503 instead of the login form. Forward the client's IP
   (`X-Forwarded-For` from Caddy, as `empireLogin` already does) on the auth-refresh call, so PocketBase rate-limits
   per visitor, not per server. The website's session cookie behaviour is otherwise unchanged.
2. **S2 `pick` without synthetic categories.** "Uncategorised" exists only when the dashboard synthesises it (no
   database row); Switch rejects it and Add ignores it. Leave it out of `pick.spend` and `pick.income`. Find how
   `buildDashboard` can tell (e.g. a flag on the synthesised category in the source, or the source passing the
   database category names); keep `docs/API-DATA.md` accurate.
3. **S3 Import size.** `readBody` limits by bytes, not string length, and an oversized `/api/import` body gets a
   JSON `413 {error: "…"}` with the limit in MB instead of a destroyed connection (read and discard the rest, or
   answer before reading further; the client must receive the 413). Other routes keep their limit.
4. **S4 `CAT_META` lookup** by own property only (a category named `constructor`, `toString` or `__proto__` must get
   the fallback icon and colour, not an inherited value).
5. **Tests** (`npm test`): the three auth outcomes map to 401/403/503 and "unavailable" is not cached (mock
   `fetch`); `pick` excludes a synthesised "Uncategorised" but keeps a real one; `CAT_META` with `__proto__` and
   `constructor`; the byte limit with multi-byte characters and the 413 answer.

## Settled: do not re-open

- The status table in `docs/API-DATA.md` is the contract. 401 only when the Empire rejects the token.
- No new dependencies. No database writes. No change to `/api/data`'s shape other than `pick`'s content.

## Out of scope

- PayPal currency handling (waits for Patrik), the "current month" question, UI changes beyond the 503 page.
- `.env`, `config/personal.json`, `prisma/`.

## Rules (no sandbox: these are rules, not walls)

Work only inside the worktree. Never commit, push or change git config (Claude commits). Install nothing
(dependencies are installed). No network. No secrets, real transactions or personal data in files or tests.
Never decide a number or add a fallback that hides a failure.

## Done when

- `npm test` passes with the new tests; `npx tsc --noEmit` passes.
- Your final message lists files changed, the exact test and typecheck summary lines, and anything doubtful.
