# Brief 223: checking balances against the bank

Claude runs this on the server after placing this branch's code there for review. It reads the database in a
repeatable, read-only transaction and reads only bank files explicitly named in a manifest. It does not import,
update, backfill or deploy anything. No real bank files or manifests belong in this worktree.

Create a manifest outside every repo, using the database account ids and full bank exports. For example, this
fictional manifest maps each export to its account and declares the bank's actual booking order:

```json
{
  "files": [
    { "accountId": "fictional-current", "file": "current.csv", "order": "newest-first" },
    { "accountId": "fictional-savings", "file": "savings.xml", "order": "oldest-first" }
  ]
}
```

Paths are relative to the manifest, or absolute. Include every account and the full days being checked; do not
use a partial first/last day. `order` must reflect the bank's own booking order, including its same-day order;
date sorting alone is insufficient. The check deliberately does not derive expected closings from balance chains.
It takes the last running balance on each day in the declared bank order. Overlapping files must agree on their
daily closings. For a CSV needing a saved/confirmed layout, add `layouts: [<CsvLayout>]` to its entry. A file with
no balances or an unconfirmed layout fails rather than silently passing. CAMT/MT940 readers provide reconstructed
running balances only where their opening/closing balance checks permit them. Exports with no booked balances
cannot independently validate this line.

From the server's aresium checkout, with its usual database environment configured, run exactly:

```sh
npx tsx scripts/check-balances.ts /absolute/path/balance-files.json
```

An optional manifest `today: "YYYY-MM-DD"` freezes the dashboard date for a repeatable review.

The script first compares the retained old source builder (`src/engine/legacy-source.ts`) and the new source,
then both dashboards, removing only `balanceByDay`, `openingBalance`, `dayBalance`, `endBalance`,
`overview.balance` and `balanceUncertainDays`. Every other field must be identical, including ordering, category
menus, totals, receipts and paybacks. Keep the old path until this check succeeds on the server.

Then it compares each account/day's new database closing with the bank's own closing for that day. The JSON report
contains `accountDaysChecked`, `matched` and `issues` (`missing`, `different`, `uncertain`), plus all database
`balanceUncertainDays`. It reports account ids and days, without payment text or amounts. Exit status is zero only
if parity passes, all supplied days match, and no uncertain database closings remain. An uncertain stored-order
fallback is reported even when its number happens to match the bank. Inspect the relevant bank day to resolve it;
do not call a fallback a proven closing. This comparison covers the days/accounts in the supplied files; include
the full history to validate the full chart. Unit tests separately cover carry-forward and summation.

If the script fails before producing its report, check the manifest, bank format/layout and database access.
It suppresses assertion/error detail to avoid printing stored payment data. It never runs the mutating
`backfill:balance` script. Missing database balances need a separate decision by Claude.

## iPhone handoff

Run `npm run engine` in this worktree. Claude must copy the generated `dist/aresium-engine.js` into the app's engine
resource, update the phone's stored-payment-to-`SourcePayment` adapter to pass each payment's stable `accountId`,
and rebuild the app. The bundle alone cannot separate accounts if the app drops their identity. Do not use import
sequence or database ids as `statementOrder`; omit it unless genuine bank order is stored. Existing imports keep
their payment/external ids and need no reimport for chain reconstruction.

Ensure Swift's source/dashboard balance decoders accept `null` (`openingBalance`, `balanceByDay`, `dayBalance`,
`endBalance`, `overview.balance`) and preserve gaps in charts. The optional `balanceUncertainDays` can be ignored
by older decoders or surfaced for review. Run the proving cases through JavaScriptCore on the app as well; the Node
VM bundle test checks the same JSON outputs without Node or browser APIs. No app files were changed in this brief.
