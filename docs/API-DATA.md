# `GET /api/data`: the dashboard data (version 2)

**Status:** live since 2026-10-23 (`prompts/01-server-calc.md`). Real data at the switch: 2,785 values identical to version 1; gzip size 30 KB → 39 KB. Clients: the website
(`web/public/app/data.js`) and the iPhone app (`empire-ios`, Aresium).

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
interface Category { name: string; icon: string; color: string; kind: "spend" | "income" | "transfer" }

interface Txn {
  id: string; date: string; day: number; month: MonthKey;   // date "2026-10-03", day 3, month "2026-10"
  amount: number;                    // negative = money out
  categoryName: string;              // primary category ("Uncategorised" if none)
  tags: string[];                    // extra categories the user "Add"-ed
  place: string; city: string;
  categoriesIn: string[];            // [categoryName, ...tags] without duplicates: where it is listed on the spend side
  incomeBuckets: string[];           // amount > 0 only: [primary bucket, ...tagged income buckets]; [] otherwise
}

interface Totals {
  expense: number;                   // money out, counted once (primary category, kind "spend")
  income: number;                    // money in, counted once (every amount > 0)
  categories: { name: string; total: number }[];      // spend categories incl. tagged txns, total > 0, largest first
  incomeBuckets: { name: string; total: number }[];   // incl. tagged txns, largest first
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

All money values are rounded to cents. Spend values are positive numbers (money out). `spend` series are
never below 0 (refunds inside a category do not make it negative), as in version 1.

## Rules the server applies (clients never re-implement these)

- **Counted once vs listed in several places.** A transaction's amount belongs to its primary category for
  every headline figure (`expense`, `income`, `overview`, `dayExpense`). `tags` only widen where it is listed:
  a category's own totals, series and list include its tagged transactions, so category rows may overlap.
- **Income buckets.** Money in (amount > 0) is grouped by its primary category if that category is of kind
  `income` or `transfer`, or is `Tax`; a positive amount in a spend category is `Refunds`; no category is
  `Other`. Tagged income/transfer/Tax categories add further buckets. `incomeBuckets` carries the icon and
  colour for each, including `Refunds` and `Other`.
- **Balance** is the bank's own balance, carried forward on days without a booking.
- **Foreign currency** (PayPal, decided 2026-10-24): a purchase in another currency counts at its euro cost (the
  euro row of PayPal's "Allgemeine Währungsumrechnung" with the purchase's code), keeping its category; both
  conversion rows are left out of every figure (`src/data/paypal-fx.ts`). Without a euro row the rows stay as they
  are and the server logs the code. Every amount the API sends is in euros.
- **Recategorise choices** (`pick`): money out (amount ≤ 0) can move among `spend` categories, money in among
  `income`/`transfer` categories and `Tax`. Each list starts with the categories in the order of their
  all-time rows (`total.categories` / `total.incomeBuckets`), then the rest alphabetically. Only database
  categories are offered: a synthesised `Uncategorised` is omitted from both lists, while a real database
  category with that name remains eligible under the same kind rules.

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

## Auth

As every `/api/*` route: the website's session cookie, or `Authorization: Bearer <Empire token>` from the
iPhone app (`src/web/empire-auth.ts`). Every `/api/*` route answers a failed check with one of three statuses
(agreed 2026-10-23 after the pre-TestFlight council), each with a JSON body `{error}`:

| Status | Means | Client does |
|---|---|---|
| **401** | No token, or the Empire rejects it (expired, password changed) | log out |
| **403** | The token is valid but the account may not use Aresium (not approved, `aresium` not in its services, not in `EMPIRE_ALLOWED_USERS`) | log out and say why |
| **503** | The Empire could not be asked (down, timeout, rate-limited) | keep the session and the data, say "try again" |

The server never turns "could not check" into 401: an outage must not log anyone out.
