# `GET /api/data`: the dashboard data (version 2)

**Status:** live since 2026-10-23 (`prompts/01-server-calc.md`). Real data at the switch: 2,785 values identical to version 1; gzip size 30 KB → 39 KB. Clients: the website
(`web/public/app/data.js`) and the iPhone app (`empire-ios`, Aresium).

## Language

Send `Accept-Language: en` or `de`. Among English/German tags (including regional tags), the highest
`q` wins; equal weights use the first tag. Unsupported or malformed entries are ignored; missing,
unreadable or unsupported headers fall back to English. Tags with `q=0` are not selected.

`/api/pulse`'s `line`, API authentication errors (401/403/503), import errors (409/413/400 and each
`results[].error`), and transaction/category/tag errors follow this language. API responses set
`Content-Language: en` or `de`. German pulse lines use German month names and whole-euro formatting
(e.g. `1.339 € im Oktober ausgegeben`). Statuses, keys and numeric values stay the same.

`/api/data` keeps the language-independent v2 fields: month `label` and `short` remain English; clients format months from
`year` and the zero-based `month`. Category/account names, transaction text and original records are
never translated, including old stored rows. The dashboard defaults to English and its language button selects English/German, also sent on API calls.
The login flow and Telegram bot remain English. Shared API wording lives in `src/lib/texts.ts`;
brief 218's dashboard mutation wording lives with its handlers in `src/data/web-ledger.ts`.

## Why version 2

Version 1 sent the raw transactions and let the browser calculate every total, chart line and list
(`buildAresiumData` in `web/public/app/data.js`). An iPhone app would have to copy those ~25 calculations,
and two copies drift apart. Version 2 sends the numbers ready-made: **the server calculates, clients only
look up, filter and display** (`ares-empire/EMPIRE.md` → "How we build apps").

It is still one request per page load, so switching months or categories stays instant. Measured on the
real data 2026-10-23: 1,088 transactions, DB query 181 ms, every combination of the old calculations 57 ms.

## Shape

```ts
type MonthKey = string;               // "2026-10"

interface Dashboard {
  version: 2;
  months: Month[];                    // oldest first, every month from the first to the last transaction
  categories: Category[];             // every category, plus "Uncategorised" if any txn has none
  incomeBuckets: Category[];          // meta for every income bucket that occurs (see "Income buckets")
  transactions: Txn[];                // same order as version 1 (booking date ascending)
  overview: { expense: number[]; income: number[]; balance: number[] };   // one value per month, same index as `months`
  total: Totals;                      // all time
  byMonth: Record<MonthKey, MonthData>;   // every month in `months`
  spend: Record<string, Series>;      // every category in `categories`
  income: Record<string, Series>;     // every bucket in `incomeBuckets`
  pick: { spend: string[]; income: string[] };   // recategorise choices, in display order (added 2026-10-23)
  paybacksIgnored?: { from: string; to: string; reason: string; amount?: number }[]; // only when a link is ignored or clamped
}

interface Month { key: MonthKey; label: string; short: string; year: number; month: number; days: number; partial: boolean }
interface Category {
  name: string; icon: string; color: string; kind: "spend" | "income" | "transfer";
  otherSide?: true;                  // also offered for the other direction of money; totals follow payment direction
}

interface Txn {
  id: string; date: string; day: number; month: MonthKey;   // date "2026-10-03", day 3, month "2026-10"
  amount: number;                    // negative = money out
  counted?: number;                  // amount that counts, only when a payback changes it
  paidBack?: number;                 // euros this expense got back
  paidBackBy?: { payment: string; amount: number }[]; // incoming payment ids and applied euros
  paysBack?: { payment: string; amount: number }[];   // expense ids and applied euros, after limits
  categoryName: string;              // primary category ("Uncategorised" if none)
  tags: string[];                    // extra categories the user "Add"-ed
  place: string; city: string;
  categoriesIn: string[];            // money out and covered cash: primary and tagged spending categories, without duplicates
  incomeBuckets: string[];           // money in only: primary and tagged categories; unsorted money in uses Uncategorised
}

interface Totals {
  expense: number;                   // counted money out minus covered cash, counted once; excludes transfers
  income: number;                    // counted money in, counted once; excludes transfers and covered cash
  categories: { name: string; total: number }[];      // spending rows incl. tagged txns, total > 0, largest first
  incomeBuckets: { name: string; total: number }[];   // incl. tagged txns, total > 0, largest first
}

interface MonthData extends Totals {
  endBalance: number;                // bank balance on the month's last day (today for the current month)
  dayExpense: number[];              // one value per day, length = month.days
  dayExpenseRunning: number[];       // running total of dayExpense through the month (added 2026-10-23)
  dayIncome: number[];
  dayBalance: number[];
}

interface Series {
  months: number[];                  // one value per month, same index as `months`
  days: Record<MonthKey, number[]>;  // every month in `months`, length = month.days
}
```

All money values are rounded to cents. Spending is shown as positive money out. Rows show only totals above
zero; `spend` and `income` series are never below zero. Covered cash and paybacks linked by hand are the two
deductions from spending. Optional payback fields are absent when nothing applies, so sources without links
keep exactly the same JSON.

## Rules the server applies (clients never re-implement these)

- **Counted as it happened.** Every payment counts once in the direction it went: money out (amount < 0)
  is spending and money in (amount > 0) is income, whatever the category's side. This applies to all-time,
  monthly and daily headlines, the running spending line, and category rows and series. A returned €100
  order without a link shows €100 spent and €100 received under that category; the refund never lowers spending. Money
  out in an income category is spending under that category and never lowers income. A category can have
  both rows in one month. Zero amounts count nowhere.
- **Transfers** count as neither spending nor income and have neither listing index. A transfer tag adds
  no row or series value, and tags on a primary transfer do not make it count anywhere.
- **Tags** widen where a payment is listed: its counted amount appears under each primary and tagged category,
  once per category, on the payment's direction only. Category rows may overlap; headline figures never
  count tags again.
- **Spending lists** (`categoriesIn`) contain the primary and tagged categories only for money out and
  covered cash rows. Unsorted money out stays under `Uncategorised` (shown as "Not sorted").
- **Income rows** (`incomeBuckets`) use the payment's own primary and tagged category names for money in,
  whatever their sides. Unsorted money in uses `Uncategorised`. No `Refunds` bucket is made. The dashboard's
  `incomeBuckets` metadata carries each row's category icon and colour, with a default look for `Uncategorised`.
  Money out and covered cash rows have no income buckets. Each spending or income list sums to its row.
- **Cash covered by receipts is the first exception.** A withdrawal's positive `coveredBy` row moves spending
  from the withdrawal to the receipt's category. It lowers the withdrawal's spending in its own month and
  its primary and tagged categories, and never counts as income. The receipt counts as spending on its
  own day. Cash entries received count as income, and cash entries spent count as spending by the same
  rules as other payments.
- **Money paid back is the second exception, only with a link made by hand** (brief 201). A stored payment
  coming in may carry `paysBack: [{ payment, amount }]`: the stored expense's id and euros paid back, positive
  whole cents. Nothing is matched automatically. Each applied euro lowers that expense in its own month,
  day, primary category and tags, and comes off the incoming payment's income on its own day. All headlines,
  rows, series, the running line and the pulse use `counted ?? amount`. For example, €80 spent in January
  and €40 linked back in February count as €40 spent in January and €0 income in February.
  Both payments keep their original `amount` and stay in their direction's lists, even at a counted zero;
  rows still show only totals above zero. Category sides without an explicit choice use the counted net.
  The expense carries `paidBack` and `paidBackBy`; the incoming payment's `paysBack` contains only the
  applied links. `counted` appears only when it differs from `amount`.
  Both ends must be counted stored payments in euros, after PayPal's currency folding, and neither may be
  a transfer. The target must be money out and cannot be a cash withdrawal, receipt, cash entry or covered
  row. The payer must be money in; bank-funding and folded-away PayPal rows cannot pay back anything.
  Payers apply in booking-day order, then id order; each payer's links apply in their given order. A payer
  can use at most its own amount and an expense can receive at most its own amount across all links.
  Excess euros are clamped. `paybacksIgnored` reports ignored links by `from` and `to`, with reasons
  `payer-not-money-in`, `payer-transfer`, `payer-not-counted`, `payer-not-euros`, `target-missing`,
  `target-not-counted`, `target-not-money-out`, `target-transfer`, `target-withdrawal`, `target-not-euros`
  or `invalid-amount`. A receipt or cash-row id is not a stored target (`target-missing`); a stored PayPal
  row dropped from counting is `target-not-counted`. A `clamped` report includes `amount`: euros that did
  not count, even when none of the requested amount could count. Reports are absent when there are none.
- **Balance** is the bank's own balance, carried forward on days without a booking.
- **Foreign currency** (PayPal, decided 2026-10-24): a purchase in another currency counts at its euro cost (the
  euro row of PayPal's "Allgemeine Währungsumrechnung" with the purchase's code), keeping its category; both
  conversion rows are left out of every figure (`src/engine/paypal.ts`). Without a euro row the rows stay as they
  are and the server logs the code. Every amount the API sends is in euros. PayPal's bank-funding rows
  ("Bankgutschrift auf PayPal-Konto"; in English exports "Bank Deposit to PP Account", "General Card Deposit" and
  PayPal's other funding names, since 2026-10-27) are left out too: the purchase is the PayPal row itself.
- **Where it is computed** (2026-10-27): stored payments → the dashboard's source is the shared engine's
  `buildDashboardSource` (`src/engine/source.ts`), then `buildDashboard`. The server maps its rows to the engine's
  plain input and adds the categories' icons and colours (`getDashboardSource` in `src/data/queries.ts`); the iPhone
  app in phone mode runs the same two functions on the payments it stores.
- **Category side** (engine input). Each `SourceCategory` can give `side?: "spend" | "income"`, its home
  side for category choices, and `otherSide?: boolean`, whether it is also offered for the other direction of money.
  `buildDashboardSource` uses `side` as the output category's `kind`; without it, a net above zero means
  `income`, otherwise `spend`, as before. `excludeFromTotals: true` always means `transfer` and ignores
  both fields. Only `otherSide: true` is passed to the output, so older inputs gain no JSON fields. The
  caller chooses the side; the engine does not look up default category ids. Sides decide where a
  category is offered, while payment direction decides where its money counts.
- **Recategorise choices** (`pick`): money out (amount ≤ 0) offers `spend` categories, then transfers,
  then `income` categories with `otherSide`. Money in offers `income`/`transfer` categories and `Tax` as
  before, then `spend` categories with `otherSide` (each name once). Each part follows its home side's
  all-time row order (`total.categories` / `total.incomeBuckets`), then the rest alphabetically. Transfers
  appear in both lists without needing `otherSide`. `otherSide` only widens the choices; it never changes
  how money counts. Only the caller's stored categories are offered: a synthesised `Uncategorised` is
  omitted from both lists, while a real stored category with that name follows the same kind rules.

## What clients do

Only lookups, filters and sorting for display:

| Shown | Read from |
|---|---|
| Overview chart | `overview` |
| Month screen totals, day charts, category and income rows | `byMonth[key]` |
| All-time category and income rows | `total` |
| A category's or income bucket's chart by month / by day | `spend[name]` or `income[name]`: `.months`, `.days[key]` |
| A category's list of months | `months` where the series value is > 0 |
| A category's transactions in a month | `transactions` with `month == key` and `categoriesIn` containing it, sorted by `day`; "tagged" when `categoryName` differs |
| An income bucket's transactions in a month | same with `incomeBuckets`; "tagged" when `incomeBuckets[0]` differs |

| Categories to offer when recategorising a transaction | `pick.income` if its amount > 0, else `pick.spend` |

After a change (import, recategorise, tags) clients fetch `/api/data` again.

## Other routes the clients use

- `GET /api/mode`: `{"mode":"server"}` or `{"mode":"phone"}`, which mode the iPhone app uses for this account (see
  "Mode" below).
- `GET /api/pulse`: `{line}`, one line for the Empire hub's Aresium card: this calendar month's spending
  ("€1,339 spent in October") or "Nothing imported for November yet" (`src/data/pulse.ts`).
- `GET /api/transaction/:id`: one transaction's full record (`getTransactionDetail` in `src/data/queries.ts`).
- `POST /api/transaction/:id/category` `{category}`: move it to one category (Switch). Returns the detail.
- `POST /api/transaction/:id/tags` `{categories, dropCurrent}`: also list it under these categories (Add);
  `dropCurrent: true` moves it out of its current one. Returns the detail.
- `POST /api/import` `{files: [{name, content}]}`: bank/PayPal `.csv` or CAMT `.xml` as text, max 25 MB per
  request (25 × 1024 × 1024 bytes, including the JSON envelope). Oversize requests return JSON
  `413 {error}` naming the 25 MB limit. Returns `{results: [{name, added, total, account, skipped, error?}]}`;
  409 while another import runs.

## Mode: `GET /api/mode`

Added 2026-10-27 (`empire-ios/prompts/12-engine-source-transfers.md`; plan: `ares-empire/docs/ARESIUM-FOR-OTHERS.md`
→ "One app, two modes"). The iPhone app asks once after a login which mode the account uses:

| Answer | For |
|---|---|
| `200 {"mode":"server"}` | an account in `EMPIRE_ALLOWED_USERS` that is also in `APP_SERVER_MODE_USERS`: the server holds the data, the app uses the routes above. The list is empty since 2026-10-31 (Patrik moved his data to the phone) |
| `200 {"mode":"phone"}` | any other approved account with the `aresium` service, the owner's too: the data stays on the iPhone and the engine computes there; every other route refuses an account outside `EMPIRE_ALLOWED_USERS` (403) |
| `401 {error, code: "unauthorized"}` | no token, or the Empire rejects it |
| `403 {error, code: "no_access"}` | the account is not approved or lacks the `aresium` service |
| `503 {error, code: "unavailable"}` | the Empire could not be asked |

It is the only route that does not require the owner list; `APP_SERVER_MODE_USERS` decides only the answer. Credential: the
`Authorization: Bearer` token when the header is sent, else the website's session cookie. The route asks the Empire
every time (no cache entry either way) and stores and logs nothing about the account. `error` follows the request
language; `code` is the Empire's error code (`ares-empire/docs/API-EMPIRE.md` → Errors), never translated.

## Auth

As every `/api/*` route: the website's session cookie, or `Authorization: Bearer <Empire token>` from the
iPhone app (`src/web/empire-auth.ts`). Every `/api/*` route except `/api/mode` (above) answers a failed check with one
of three statuses (agreed 2026-10-23 after the pre-TestFlight council), each with a JSON body `{error}`:

| Status | Means | Client does |
|---|---|---|
| **401** | No token, or the Empire rejects it (expired, password changed) | log out |
| **403** | The token is valid but the account may not use Aresium (not approved, `aresium` not in its services, not in `EMPIRE_ALLOWED_USERS`) | log out and say why |
| **503** | The Empire could not be asked (down, timeout, rate-limited) | keep the session and the data, say "try again" |

The server never turns "could not check" into 401: an outage must not log anyone out.

## Website parity additions (brief 218)

`GET /api/data` now also includes `today` (UTC `YYYY-MM-DD`), `monthlyAverage: {expenses, income}` and
`fixedCosts: {expenses, income}`. Existing v2 fields retain their names and accounting.

Each average is null with fewer than two finished months; otherwise `{cents, amount, count, first, last}`.
The first month is excluded when its earliest payment is after day 7. Each fixed-cost list contains
`running`, `ended`, `takenOut`, `monthlyCents`, `monthlyTotal` and `yearlyTotal`. Entries contain
`id`, `mark: {key, side, cadence, anchor}`, `newest`, `category`, `name`, `side`, `cadence`, `cents`,
`monthlyCents`, `amount`, `monthlyEquivalent`, `count`, `first`, `last`, `nextDue`, `running`, `notFixed`,
`exclusionIDs` and `ids` (newest first). Cadences: monthly, quarterly, halfYearly, yearly. Detection follows
app briefs 208/216/217, including steady days, price steps and extras carried by combined bookings.
The newest bank payment is the reference for running status; `today` controls whether the UI says next or last.

Payment rows additionally carry `nameKey`, `fixedCostKey`, `ledgerSequence`, `bankName`, `merchant`.
These are display identity metadata; they never change `id`, `externalId`, bank text, sorting or accounting.

- `POST /api/fixed-costs` `{id, ids: string[], notFixed: boolean}` excludes/restores an entry. Membership must
  still match the screen; otherwise 409. Returns `{undo}`.
- `POST /api/undo` `{undo}` consumes the returned opaque token. Returns `{undone: true}`; an intervening
  import/edit or a used token returns 409. Changes and snapshots are stored in a serializable transaction.

Both routes share the existing owner login, request limits and English/German error handling.
The public demo intercepts changes locally and asks the visitor to log in; it never calls these routes.
`WebSettings` and `WebUndo` are part of the existing full PostgreSQL backup. Migration files are shipped;
applying migrations is a deployment task, never done by the coding agent.

### Money paid back

Links are stored in `WebSettings.data.links`, by incoming payment id, as `{payment, amount}[]` and supplied
to the existing shared-engine payback accounting. A row's additive `paybackEligible` controls offering
link actions; zero remaining payments stay visible. As in the app, only stored EUR payments are offered
until folded currency is available as metadata. Transfers, withdrawals, cash/receipts and dropped rows are excluded.
The pulse also reads this accounting.

- `POST /api/paybacks/preview` `{ids: string[], others?: string[], amount?: number}` returns `{group,
  candidates, suggestions, rest, skipped, plan, revision}`. Selection must have one direction; candidates have
  the opposite direction. Suggestions rank whole/half/third/quarter/rest fits first, then date distance, in
  the app's −30/+120 day window. Candidates include every date for browser search. `plan` is null until
  `others` are chosen; otherwise it contains `links: {from,to,amount,totalAmount}[]`, `expenses` and
  `paymentsIn` allocations `{id,amount,rest}`, `linked`, `stillOpen`, `staysIncome`. Both sides are oldest
  first, then ledger sequence, then id. Optional `amount` is only for one payment on each side, in whole cents.
- `POST /api/paybacks` takes the same selection and the preview's `revision`. Recomputes under a serializable
  transaction, refuses changes since the preview (409), stores every link together and returns one `{undo}`.
- `POST /api/paybacks/link` `{from,to,amount}` changes an existing link; zero removes it. Both remaining
  limits and whole cents are validated. Returns `{undo}`. Payment ids and original amounts are untouched.

The demo has generated choice/plan examples in `demoPaybacks` in the sample, resolved locally, with no
browser accounting. Unsupported sample selections and all saves ask for login; no real API request is sent.

### Names and finding payments

`nameGroups` maps opaque keys to `{key,name,rows: string[],count,moneyOut,moneyIn,months,names,newestDate}`.
Rows are newest first. Every dashboard month has `{moneyOut,moneyIn,count}` (also zero months), using counted
whole cents and excluding transfers/covered rows. `names` retains own names and original bank spellings for
search, even while `ownNames: false`. Additional transaction metadata: `ownName`, `paymentOwnName`,
`shopOwnName`, `isOwnName`. The newest qualifying non-card bank line names a shop; merchant identities are
resolved in one universe containing payments, bank-line probes and stored rules. No name reaches sorting.

- `POST /api/names` `{ids: string[], name: string, scope: "payment"|"shop"}` stores a name for the selected
  payments or their shops and future imports. Trimmed to 60 grapheme clusters; empty removes that scope's
  name. Per-payment overrides win. Empty merchant keys allow only payment scope. Returns `{undo}`.
- `POST /api/names/display` `{enabled: boolean}` hides/shows own names, preserving them. Returns `{undo}`.

Search ranking stays in the browser (display only); name totals/months are server-built. Day pages filter
rows by date and listing indexes, without duplicate tags, and read totals directly from `dayExpense` /
`dayIncome`. Graph day indexes open those pages; month points open the existing month pages.

### Several payments at once

- `POST /api/selection` `{ids, category?}` returns `{ids,count,side,total,shops,otherCount,otherIDs,revision}`.
  Counts and counted money are computed in the engine. Covered rows and mixed directions are refused.
  Other shop payments exclude manual/structural/receipt choices, transfers, selected rows and the target category.
- `POST /api/transactions` `{ids,mode:"switch"|"add",categories:string[],removeCategories?:string[],dropCurrent?,otherPayments?,revision?}`
  changes a selection atomically, with one `{undo}`. The screen supplies `revision` from the selection preview.
  Switch sets the primary/manual category and remembers original merchant identities for future imports; Add changes
  tag membership without counting twice. `removeCategories` removes old extras, including an empty `categories` list
  when only removing; the primary stays unchanged. `dropCurrent` uses the first chosen category as primary, the rest as tags.
  `otherPayments` applies the same change to eligible shop peers after the single question. Moving to a transfer
  category removes payback links at both ends, and undo restores them.

`WebSettings.data.learned` stores original merchant keys and chosen category ids separately for each direction.
The import handler applies them to new rows after existing import categorization, preserving manual/transfer
choices. This does not change bank readers, ids or sorting rules. The legacy single-category helper is retained
as `legacyRecategorizeTransaction` for Claude's parity check; the route now uses the same batch operation.

### Sorting unsorted names

`quickSort` contains `{key,name,ids,count,side,total,first,last,examples}` groups over all unsorted payments,
separated by name key and direction, ranked by count then counted money. Example purpose lines are deduplicated.
`POST /api/quick-sort` `{key,ids,category}` checks current membership inside the batch transaction, switches
only that unsorted group and remembers its original bank identities. Returns one `{undo}`. Already sorted
payments are never included. Skip is a display choice and changes nothing on the server. The browser offers
this flow after import, after the import notice, and from Not sorted.

### Category editing

`categoryOptions` contains stored categories with stable database ids, `name`, `icon`, `color`, `side`,
`kind`, `otherSide`, `originalName`, `removed`, `default`, `protected`, `paymentCount`.
`POST /api/categories` takes one of:

- `{action:"create",name,side:"spend"|"income"}`: creates a category with a persistent icon/colour, or reuses
  a matching name (including English/German default names), restoring/offering it on this side if necessary.
- `{action:"rename",id,name}` or `{action:"rename",id,original:true}`: preserves category id, look, side,
  payments and learning; defaults remember their original name.
- `{action:"side",id,side?,otherSide?}`: pins the home side and/or its offer on the other side. Direction
  still decides counting. Changing home side keeps the previous side offered if it holds payments there.
- `{action:"delete",id}`: removes a default or deletes a custom category; removes its extra memberships,
  re-sorts its primary payments through the existing shared engine using the remaining categories and learned
  choices. Payments it cannot sort become Not sorted. Transfer links are cleared where needed.
- `{action:"restore",id}`: restores a removed default. Reserved built-ins cannot be renamed/deleted.

All return `{undo, category?}`; creation/reuse and rename/side/restore also return the selected `{id,name}`
(with stored fields). All changes, re-sorting and undo are transactional. Undo appends inverse category corrections so the audit remains append-only and its learning signal follows the restored state.
The latest undo alone is retained;
its snapshot stores category/name/link state and hashes of original bank fields, rather than copies of raw exports.
The existing category/tag routes keep their response shapes but use these atomic changes. Their old helpers
remain as `legacyRecategorizeTransaction` / `legacySetTransactionTags` until Claude checks parity.

### Remaining website views

`currentMonth` chooses the previous finished month during days 1–7 when the latest month is partial; otherwise
it is the latest month with data. The phone layout keeps this month one tap away. `summedLists` maps
`JSON.stringify([categoryName, monthKey, "spend"|"income"])` to `{key,name,ids,count,amount,latest}[]`.
Amounts use counted cents, supplied by the engine; toggling the display and selecting all of a sum are browser work.

`cashEntries` stores manual EUR cash entries using the existing engine's `SourceReceipt` shape, and `cash`
is the engine's wallet view (`months`, `movements`, as documented above). `POST /api/cash` takes
`{action:"create"|"edit",id?,shop,date,total,direction:"in"|"out",category?,paidFrom?}` or
`{action:"delete",id}`. Positive whole-cent totals, real ISO days and non-transfer categories are checked;
returns `{undo}`. The engine allocates cash spending to a chosen source or its automatic source, so withdrawals
and spending never count twice. Category rename/delete follows manual cash too. No receipt photos are supported.

The demo includes a cash gift and cash spending, and a 22-step read-only tour through the actual screens.
Graph visibility/scrolling, theme, language and sum toggles are browser display preferences; financial choices
are persisted on the authenticated server. Dashboard and preview reads use one repeatable-read snapshot;
writes use serializable transactions, with canonical hashes (JSONB object ordering never invalidates an undo).
