# AGENTS.md: for coding agents (Claude agents, Codex)

Aresium is Patrik's finance dashboard (this repo: the server, aresium.de, and the **engine** that the iPhone app also
runs). Claude (the lead) plans the work, writes your brief and checks, commits and merges what you build.

## Read first

1. Your brief (in `~/empire-ios/prompts/NN-*.md`): what to build, what is settled, what "done" means.
2. The plan: `~/ares-empire/docs/ARESIUM-FOR-OTHERS.md` (phone mode, the engine, categories, sorting, decisions).
3. Whatever the brief points to.

## Rules

- **Work only in your worktree** (the brief names it). Never commit, push, merge, deploy, or touch the server, the
  database or another repo unless the brief says so. Claude commits.
- **No real data.** There are no real payments on this Mac and you must not look for any. Build and test with made-up
  data that has the real formats (real bank header lines, invented payments). No names of real people, IBANs or
  amounts from anyone's account in files, tests or fixtures.
- **The engine stays pure** (`src/engine/`): no database, no Node built-ins, no clock or network; inputs in, results
  out, JSON-friendly. `npm run engine` bundles it for the iPhone app (JavaScriptCore) and fails if a Node built-in
  slips in. Server-only code lives outside `src/engine/`.
- **Same results first, then delete:** when logic moves, keep the old path until a check shows identical results on
  real data (Claude runs such checks on the server); say in your final message what Claude must run.
- Payment ids (`externalId`) of existing imports must never change.
- You may run `npm ci`; new packages only if the brief allows them.
- Plain English in code, comments and docs. Keep the existing style.

## Checks before you report

`npm run typecheck`, `npm test` and `npm run engine` pass. New behaviour has tests.

## Final message

Files changed; the exact check results (test counts); what Claude must run or decide; anything doubtful.
