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

`/api/data` stays unchanged: month `label` and `short` remain English; clients format months from
`year` and the zero-based `month`. Category/account names, transaction text and original records are
never translated, including old stored rows. The website explicitly requests English for its API
calls; its pages, login flow and the Telegram bot remain English. All API wording lives in
`src/lib/texts.ts`.

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
}

interface Month { key: MonthKey; label: string; short: string; year: number; month: number; days: number; partial: boolean }
interface Category {
  name: string; icon: string; color: string; kind: "spend" | "income" | "transfer";
  otherSide?: true;                  // also offered for the other direction of money; totals follow payment direction
}

interface Txn {
  id: string; date: string; day: number; month: MonthKey;   // date "2026-10-03", day 3, month "2026-10"
  amount: number;                    // negative = money out
  categoryName: string;              // primary category ("Uncategorised" if none)
  tags: string[];                    // extra categories the user "Add"-ed
  place: string; city: string;
  categoriesIn: string[];            // money out and covered cash: primary and tagged spending categories, without duplicates
  incomeBuckets: string[];           // money in only: primary and tagged categories; unsorted money in uses Other
}

interface Totals {
  expense: number;                   // money out minus covered cash, counted once; excludes transfers
  income: number;                    // money in, counted once; excludes transfers and covered cash
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
zero; `spend` and `income` series are never below zero. Covered cash is the only deduction from spending.

## Rules the server applies (clients never re-implement these)

- **Counted as it happened.** Every payment counts once in the direction it went: money out (amount < 0)
  is spending and money in (amount > 0) is income, whatever the category's side. This applies to all-time,
  monthly and daily headlines, the running spending line, and category rows and series. A returned €100
  order shows €100 spent and €100 received under that category; the refund never lowers spending. Money
  out in an income category is spending under that category and never lowers income. A category can have
  both rows in one month. Zero amounts count nowhere.
- **Transfers** count as neither spending nor income and have neither listing index. A transfer tag adds
  no row or series value, and tags on a primary transfer do not make it count anywhere.
- **Tags** widen where a payment is listed: its full amount appears under each primary and tagged category,
  once per category, on the payment's direction only. Category rows may overlap; headline figures never
  count tags again.
- **Spending lists** (`categoriesIn`) contain the primary and tagged categories only for money out and
  covered cash rows. Unsorted money out stays under `Uncategorised` (shown as "Not sorted").
- **Income rows** (`incomeBuckets`) use the payment's own primary and tagged category names for money in,
  whatever their sides. Unsorted money in uses `Other`. No `Refunds` bucket is made. The dashboard's
  `incomeBuckets` metadata carries each row's category icon and colour, with a default look for `Other`.
  Money out and covered cash rows have no income buckets. Each spending or income list sums to its row.
- **Cash covered by receipts is the one exception.** A withdrawal's positive `coveredBy` row moves spending
  from the withdrawal to the receipt's category. It lowers the withdrawal's spending in its own month and
  its primary and tagged categories, and never counts as income. The receipt counts as spending on its
  own day. Cash entries received count as income, and cash entries spent count as spending by the same
  rules as other payments.
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
