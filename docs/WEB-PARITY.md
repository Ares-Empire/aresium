# Website parity — brief 218

Baseline: 2026-11-03, before implementation. Both desktop and phone layouts use the same server dashboard.
The explicit English/German requirement in brief 218 supersedes the older English-only website decision.

| Changelog | Feature | Website before | Work / reason |
|---|---|---|---|
| Nov 2 | Finished-month average; fixed costs; regular income; cadence, steady day, next due; Ended; Not fixed and undo | no | Step 1: port current Swift detection, including briefs 216/217, to the engine |
| Nov 2 | Several expenses and paybacks, oldest first, preview and undo | partly | Engine counts links; server storage and both interfaces missing (step 2) |
| Nov 2 | Link money paid back from either payment, suggestions/search, own-share totals | partly | Engine only; step 2 |
| Nov 2 | Select by sliding, calm ticks, scroll while selecting | no | Step 4: checkboxes and shift-click on desktop, tick controls on phones; native gesture not required |
| Nov 2 | Sort unsorted names, most payments first; separate directions; skip/undo/learn | no | Step 5 |
| Nov 2 | Import via share sheet / AirDrop, hold until unlocked, delete temporary file | not for the website | Native file lifecycle; website already has its file picker |
| Nov 2 | First-run categories, useful Current range early in month, plain German button | partly | Website has no initial category selection; early-month range and wording need attention |
| Nov 2 / Oct 29 | TestFlight, beta review, signing and builds | not for the website | App distribution |
| Nov 1 | Local places and sorting/reading evaluation, three rounds of fixes | partly | Engine has these; changes to bank reading and sorting rules are explicitly out of scope |
| Nov 1 | Change many payments' categories/tags/names, one shop question, undo | no | Step 4 |
| Nov 1 | Rename/delete categories and reuse an existing name | no | Step 6 |
| Nov 1 | Search own/bank names, best match first; day page; stable shop identity | no | Step 3; use engine merchant identities |
| Nov 1 | Category home side and offer on the other side; count each direction as happened | partly | Engine counting and choice rules exist; persistence/editing missing (step 6) |
| Oct 31 | New category inside category pickers | no | Step 6 |
| Oct 31 | Day labels as dates; name months open pages; all/none grouping | partly | Category months exist; name pages/grouping missing (step 3 / extras) |
| Oct 31 | Graph inspection, tap navigation, graph scrolls away, settings | partly | Desktop hover/month navigation exists; phone graph navigation/preferences need completion |
| Oct 31 | 18-step guided tour | no | Extra work after numbered features |
| Oct 31 | Contact/support, Get the app, legal coverage | yes | Existing /contact and /kontakt and app links |
| Oct 30 | Rename at name; category chip editing; stable shop identity; sum names in lists | partly | Category editor exists; name changes/grouping missing (steps 3/4) |
| Oct 30 | Name page with totals and months, remembered names on new imports | no | Step 3 |
| Oct 30 | Local notifications for imports and monthly review | not for the website | Native scheduling; no browser notification service in this brief |
| Oct 30 | Smooth selection, back navigation, category shortcut, Later/Back/Done, busy states, discard/exit confirmation | partly | Browser back buttons and save spinners exist; apply appropriate controls to new screens |
| Oct 30 | Face ID / messages cover, system appearance following | not for the website | Native OS behavior; website already has light/dark/red themes |
| Oct 30 | Duplicate prevention, better sorting, category picker speed, custom category look | partly | Engine already contains fixes; importer and sorting rules excluded; category look in step 6 |
| Oct 28 | Receipt photo/scan, correction, bank matching and no photo retained | not for the website | Explicit exclusion: reading receipt photos and their native capture flow |
| Oct 28 | Manual cash in/out, wallet sources, Cash page | no | Extra work after numbered features; distinct from excluded photo capture |
| Oct 27 | No account, optional Face ID/code, phone-only storage | not for the website | Website deliberately stores owner changes on the authenticated server |
| Oct 27 | Empty first screen and made-up tour | partly | Public demo exists; empty dashboard/tour need attention |
| Oct 27 | Unknown bank preview/send format, missing-bank request, 16-bank guide | partly | Engine and contact page exist; reading bank files/sorting rules excluded; guide is extra work |
| Oct 27 | Public read-only demo, no requests or writes to real API | yes | Extend sample and refusal behavior for every new screen |
| Oct 27 | 25 banks, shop rules, learning, phone-only engine | partly | Shared engine exists; website importer changes excluded; remembered manual choices added here |

## Delivery record

The table above preserves the required before-implementation inventory. The final outcomes are below.

| Feature | Final status | Implementation / reason |
|---|---|---|
| Monthly averages, fixed costs and regular income | done | Shared engine port of briefs 208/216/217; both overview lines, three sections, next/last, correction and undo |
| Money paid back, single and several | done | Engine eligibility/ranking/pouring, server preview and atomic storage, both payment ends, editable links, one undo |
| Selection by sliding | not for the website | Desktop uses checkboxes and shift-click; phone uses taps, as explicitly settled |
| Selecting and changing many payments | done | Shared list controls; switch/add/name; shop question; counts and money from engine; atomic undo |
| Quick sort of unsorted names | done | Engine groups over all months, directions separate, largest first; offer after import and on Not sorted; skip and undo |
| Search, stable names, name/month pages, renaming | done | Search ranking in browser; identities and all totals/months in engine; original bank spellings retained; server rules name future imports |
| Day pages and chart navigation | done | Both directions, graph totals, category labels, touch side change; keyboard and pointer chart navigation |
| Categories created where chosen | done | One creation control reused by change picker, quick sort and manual cash; existing default names reused in either language |
| Category rename/delete/restore and sides | done | Stable ids and looks; default removal/restoration; shared-engine re-sort; custom deletion; side/other-side choices |
| Names added up in lists, all/none selection | done | Engine supplies sum rows; browser toggles the view and selects the rows' member ids; covered adjustments retained |
| Monthly graph unfinished month; persistent graph and scroll preference | done | Dashed final segment; browser display preferences; scrolling phone graph |
| Early-month Current and useful empty first screen | done | Server supplies review month in days 1–7; this month stays reachable; Import data / Start tour without fake owner numbers |
| First-run category checkbox choice | not for the website | The server already has its category catalog. The phone-only first-run chooser does not exist on the website |
| Tour | done | 22 steps over the actual demo pages and controls, both languages, no writes |
| Manual cash and wallet view | done | Existing engine cash allocation; manual in/out/edit/delete/source, category picker/new category, undo, sample gift/spending |
| Receipt camera/OCR/photo checks and bank joining | not for the website | Explicit exclusion: reading receipt photos and its native capture flow |
| Bank file share sheet, AirDrop, lock queue and temporary-file lifecycle | not for the website | Native iOS features explicitly excluded; existing website picker retained |
| Unknown-bank preview/layout submission, extra bank formats, reading/sorting rule fixes | not for the website | Reading bank files and sorting rules explicitly excluded; existing shared-engine changes remain untouched |
| Bank guide and missing-bank contact | done | Help explains the website's supported VR Bank / PayPal / CAMT exports and links Contact & support. The app-only extra formats are identified as such |
| Face ID / own code / phone-only store / system cover | not for the website | Explicit native exclusions; website keeps authenticated server storage |
| Local reminders/monthly notifications, widgets | not for the website | Native notification scheduling and widgets; no browser notification service is introduced |
| System appearance changes and native keyboard/sheet comfort | not for the website | OS-specific behavior; existing web light/dark/red retained; new screens use normal buttons, labels, busy/undo states and back links |
| Signing / TestFlight / beta review | not for the website | App distribution |
| Contact, app request links, legal links | done | Existing contact/legal links retained, linked from Help and demo |
| Public demo | done | Generated invented data for every page; changes refused locally; no real API requests; generated preview examples for paybacks and selections |
| English and German | done | Language switch, interface text, money/dates, API errors, tour and all new pages |

Steps **0–6 are implemented**. Step **7** adds cash, sums, empty state, graph preferences, early-month Current,
unfinished-month graph, guide/help and the tour. Phone-only import/lock/notification features are excluded above.

### Checks and handoff

Final checks: `npm run typecheck` passed; `npm test` passed **624 tests, 0 failed, 0 skipped**;
`npm run engine` passed (560,768-byte bundle); Prisma schema validation passed without a database connection.
The fixed-cost port has 40 tests covering the app's data cases through brief 217. The original sample-source hash
and import-id checks still pass.

Existing installed Playwright/Chromium were used; none was installed. Browser QA passed all four runs:
English/German × 1440px desktop/390px phone, 110 screenshots, 0 browser errors, 0 real API requests from the demo.
It exercises real navigation, shift-click selection, all 22 tour steps, empty screens and every mutation refusal.
See `build/218-browser-report.json`, `build/218-*.png`, and the reproducible `scripts/check-web-parity.mjs`.
Node timing on 5,000 invented payments: median 86 ms for the complete shared dashboard enrichment (four measured
rounds after warm-up); this is a Mac/Node measurement, not an iPhone timing. No database was accessed,
migrated or modified, and no commit, push, deployment or edit outside this worktree was made.

Claude must check the migrations against the existing server schema, mark the pre-218 baseline applied, then apply
the additive migration (commands in DEVELOPMENT.md). The database's existing whole backup includes both new tables.
Copy the generated sample into `empire-ios/Aresium/AresiumTests/server-dashboard.sample.json` when updating that
fixture, run its consumers, and deploy the website/engine through the existing process. Do not switch the app's Swift
fixed-cost implementation in this brief.

Before removing the retained legacy single-category/tag helpers, Claude must compare their behavior with the new
atomic paths on a disposable server copy, and compare baseline dashboard figures without new choices (spending,
income, monthly/day/category series, bank balances and external ids). Test new paid-back links separately: their changed
spending/income is intentional, with balances and original amounts unchanged. Fixed-cost exclusions use an original
merchant key plus side/cadence/payment anchor; an anchor surviving a price change or combined booking retains its mark.
A mark whose anchor no longer belongs to any detected entry is retained in storage but matches nothing.

The demo intentionally cannot save any change. Its generated payback previews cover every single pair and the
several-payment examples in the tour; other group combinations/custom amounts ask for login, rather than running
financial calculations in the browser. Authenticated preview/save routes support arbitrary valid selections.


### Changed files

- Documentation: `docs/API-DATA.md`, `docs/DEVELOPMENT.md`, `docs/WEB-PARITY.md`.
- Schema and migrations: `prisma/migrations/20261103090000_baseline/migration.sql`, `prisma/migrations/20261103100000_web_parity/migration.sql`, `prisma/migrations/migration_lock.toml`, `prisma/schema.prisma`.
- Sample generation and browser QA: `scripts/build-sample.ts`, `scripts/check-web-parity.mjs`.
- Server data and samples: `src/data/dashboard.ts`, `src/data/queries.ts`, `src/data/web-ledger.ts`, `src/data/web-sample.ts`.
- Shared engine and tests: `src/engine/engine.test.ts`, `src/engine/fixed-costs.test.ts`, `src/engine/fixed-costs.ts`, `src/engine/index.ts`, `src/engine/ledger-dashboard.test.ts`, `src/engine/ledger-dashboard.ts`, `src/engine/payback-plan.test.ts`, `src/engine/payback-plan.ts`, `src/engine/quick-sort.test.ts`, `src/engine/quick-sort.ts`, `src/engine/selection.test.ts`, `src/engine/selection.ts`, `src/engine/source.ts`.
- HTTP routes and tests: `src/web/search.test.ts`, `src/web/server.test.ts`, `src/web/server.ts`.
- Website and generated sample: `web/public/app/app.jsx`, `web/public/app/chart.jsx`, `web/public/app/dashboard.sample.js`, `web/public/app/dashboard.sample.json`, `web/public/app/data.js`, `web/public/app/display.js`, `web/public/app/language.js`, `web/public/app/mobile.jsx`, `web/public/app/panels.jsx`, `web/public/app/search.js`, `web/public/app/tour.jsx`, `web/public/app/upload.js`, `web/public/index.html`.

Generated review artifacts: 110 PNGs, the browser report, check logs and an invented local owner record in `build/`.

### Round 2 — readability and visual review

Round 2 steps **1–4 are complete**. The original build steps **0–6 remain complete**, with the step 7 extras
listed above. The refactor preserves the accounting and persistence behavior; 624 tests still pass.

The shared desktop/phone page file was replaced with feature files under `web/public/app/`:

- `fixed-costs.jsx`, `paybacks.jsx`, `names.jsx`, `day.jsx`, `selection.jsx`, `quick-sort.jsx`, `categories.jsx`,
  `cash.jsx`, and `empty-dashboard.jsx` hold their screens.
- `page-helpers.jsx` holds formatting, navigation events, authenticated requests, and dirty-form guards.
  `page-navigation.jsx` holds the page host and shell tools.
- Styles are split between `fixed-costs.css`, `paybacks.css`, `names.css`, `selection.css`, `categories.css`,
  `empty-dashboard.css`, `page-navigation.css`, `form-controls.css`, `demo.css`, `display.css`, and `tour.css`.
- `index.html` loads the feature files in dependency order for both the authenticated website and the public demo.
  The shells and tour use the renamed shared tools and page selectors.

The source now has one statement per line, nested JSX on separate lines, and named handlers for longer actions.
Server, engine, sample builder, language, tour, tests, and QA code were expanded as well. Unchanged existing
statements retain their original formatting. Every added or changed source line, including the new SQL, is at
most 120 characters. Generated sample JSON/JavaScript remain compact payloads; they are excluded from the
source line-length measurements.

Tick boxes and radio buttons use tick circles drawn in the website's colours. Primary page/tour actions and
search-clear controls use the same palette. Payback headings identify expenses or payments in, suggestion
captions only include a separator when there is another part, and payment rows omit a leading separator when
there is no location. Fixed-cost action buttons align with the name and amount. Currency values stay together.
The demo pages scroll above the demo banner, and their focus rings remain inside the scroll region.

Final validation: `npm run typecheck` passed; `npm test` passed **624 tests, 0 failed, 0 skipped**;
`npm run engine` passed (**560,768 bytes**); `npm run sample`, Prisma validation and `git diff --check` passed.
Installed headless Chromium was used without installing anything. All **110 screenshots** were reviewed in
English and German at desktop and phone widths, including scrolled Ended/settings views. Browser checks found
**0 errors and 0 real API requests**, and check tick appearance, separators and fixed-cost action alignment.
Artifacts are `build/218-*.png`, `build/218-browser-report.json`, and the `build/218-review-*.jpg` contact sheets.
The migrations, iOS fixture copy, retained-path server comparisons and deployment remain Claude's handoff above;
none was run here. The demo preview limitation documented above remains.

### Round 2 line-length measurements

Measured as Unicode characters per physical line, including blank lines, before Round 2 and after the refactor.
Generated `dashboard.sample.json` and `dashboard.sample.js` remain compact generated payloads and are excluded.
Unchanged lines in existing files keep their original formatting. Every added or changed source line is at most 120 characters.

| File / group | Before average | Before max | After average | After max |
| --- | ---: | ---: | ---: | ---: |
| `web/public/app/parity.jsx` → split pages combined | 143.22 | 975 | 28.34 | 119 |
| `web/public/app/parity.css` → split styles combined | 98.57 | 293 | 15.88 | 107 |
| `scripts/check-web-parity.mjs` | 107.98 | 345 | 36.35 | 119 |
| `src/data/web-ledger.ts` | 85.24 | 622 | 34.93 | 120 |
| `src/data/web-sample.ts` | 110.33 | 423 | 29.81 | 117 |
| `src/engine/fixed-costs.test.ts` | 100.69 | 352 | 31.56 | 119 |
| `src/engine/fixed-costs.ts` | 71.76 | 198 | 35.16 | 116 |
| `src/engine/ledger-dashboard.test.ts` | 114.97 | 399 | 28.86 | 120 |
| `src/engine/ledger-dashboard.ts` | 98.80 | 461 | 36.99 | 119 |
| `src/engine/payback-plan.test.ts` | 102.58 | 373 | 30.79 | 97 |
| `src/engine/payback-plan.ts` | 94.83 | 252 | 35.45 | 114 |
| `src/engine/quick-sort.test.ts` | 137.75 | 336 | 29.48 | 110 |
| `src/engine/quick-sort.ts` | 75.80 | 151 | 43.82 | 104 |
| `src/engine/selection.test.ts` | 91.70 | 277 | 22.77 | 99 |
| `src/engine/selection.ts` | 89.62 | 150 | 44.89 | 101 |
| `src/web/search.test.ts` | 92.71 | 233 | 30.12 | 102 |
| `web/public/app/cash.jsx` | split above | split above | 27.67 | 102 |
| `web/public/app/categories.css` | split above | split above | 17.19 | 44 |
| `web/public/app/categories.jsx` | split above | split above | 27.09 | 104 |
| `web/public/app/day.jsx` | split above | split above | 30.79 | 103 |
| `web/public/app/demo.css` | split above | split above | 13.95 | 48 |
| `web/public/app/display.css` | split above | split above | 16.97 | 56 |
| `web/public/app/display.js` | 121.30 | 274 | 24.19 | 115 |
| `web/public/app/empty-dashboard.css` | split above | split above | 17.22 | 26 |
| `web/public/app/empty-dashboard.jsx` | split above | split above | 20.35 | 56 |
| `web/public/app/fixed-costs.css` | split above | split above | 13.95 | 44 |
| `web/public/app/fixed-costs.jsx` | split above | split above | 33.20 | 116 |
| `web/public/app/form-controls.css` | split above | split above | 20.11 | 107 |
| `web/public/app/language.js` | 206.57 | 1421 | 38.48 | 111 |
| `web/public/app/names.css` | split above | split above | 14.93 | 44 |
| `web/public/app/names.jsx` | split above | split above | 27.58 | 113 |
| `web/public/app/page-helpers.jsx` | split above | split above | 25.48 | 119 |
| `web/public/app/page-navigation.css` | split above | split above | 12.51 | 37 |
| `web/public/app/page-navigation.jsx` | split above | split above | 28.66 | 117 |
| `web/public/app/paybacks.css` | split above | split above | 14.25 | 31 |
| `web/public/app/paybacks.jsx` | split above | split above | 29.77 | 112 |
| `web/public/app/quick-sort.jsx` | split above | split above | 27.66 | 83 |
| `web/public/app/search.js` | 56.81 | 193 | 27.82 | 116 |
| `web/public/app/selection.css` | split above | split above | 12.33 | 25 |
| `web/public/app/selection.jsx` | split above | split above | 29.79 | 102 |
| `web/public/app/tour.css` | split above | split above | 15.27 | 40 |
| `web/public/app/tour.jsx` | 168.09 | 670 | 27.83 | 110 |
