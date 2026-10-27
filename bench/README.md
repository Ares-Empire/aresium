# Sorting measurements

This bench measures the shared sorting engine. It does not change existing server
categorization or add an HTTP route. The engine exports the bilingual default list,
two built-ins, merchant normalization, starter rules, `sortPayments`, and `learn`.
A person's selected category ids (including their own ids) constrain sorting.
Unsorted results have `categoryId: null` and `source: null`.

## Local check with fictional payments

```sh
npm ci
npm run typecheck
npm test
npm run engine
npx tsx bench/fake-data.ts
npx tsx bench/run.ts
npx tsx bench/run.ts --limit 100
npx tsx --test src/sort/groq.test.ts src/sort/bench.test.ts
```

The fake data has 480 payments across 12 months. It includes all 21 answer-key
category names, changing branches, repeat merchants, unknown merchants, conflicting
choices at one shop, and, each month, what the structural rules sort: two PayPal
purchases as both exports show them (PayPal's row with the shop, its funding row, the
bank's bare "PayPal" line), an own transfer to a savings account with its IBAN, and two
unrelated payments of equal amounts on the two accounts, which must not pair. The tests call the bench with
`--groq` and an injected fake fetch, write/read `results.md`, and inspect printed
output. No key, database, network request, or real payment is needed. Tests preserve
any pre-existing bench input and output.

## Server use by the operator

Only `export.ts` imports Prisma. Its single query is `transaction.findMany`,
restricted to `categorySource` `rule` or `manual` (D6); it writes every matching
payment, and fails if a payment lacks a category in the fixed map. It never updates
the database. Do not run the export on a developer machine or copy its output there.
Besides the text it writes what the structural rules need: the source (`bank` or
`paypal`), the currency, the account, the account's IBAN, and the other party's IBAN.
The database has no column for the last one; the export reads it from the stored
original row, which the server keeps already parsed (a VR Bank CSV row as column → cell,
`IBAN Zahlungsbeteiligter`; a CAMT entry's creditor or debtor account), with the
engine's own functions. Accounts and IBANs are written as local aliases (`account-1`,
`iban-1`; the same IBAN, the same alias), never the real values.

```sh
npx tsx bench/export.ts
npx tsx bench/run.ts
npx tsx bench/run.ts --groq
npx tsx bench/run.ts --groq --model openai/gpt-oss-120b --limit 100
```

`--groq` reads `GROQ_API_KEY` from the environment or `.env`. `--model` changes the
model, and `--limit` selects the earliest n payments, after sorting by date. Input
is an array of `{reference, date, amount, description, counterparty, trueCategory}`;
date is a UTC `YYYY-MM-DD` string, amount a number, and counterparty a string or null.
Optional, for the structural rules: `source`, `currency`, `account`, `accountIban` and
`counterpartyIban` (aliases, see above). Without them every payment is sorted on its
own text, as before.
Export references are local sequence numbers, never bank ids. Groq receives new
references with just date, amount, description and counterparty; no answer category.
Input and output are fixed at `bench/out/data.json` and `bench/out/results.md` and
are git-ignored. Read only the aggregate report on the server. CLI failures use
fixed messages so JSON parsing or provider errors cannot echo payment data.

## What the measurements mean

- Sorting is the engine's, as the app sorts: one `sortPayments` call over all payments
  up to the point in the replay, so the structural rules (own transfers: PayPal's bank
  lines and funding rows, pairs between accounts with proof) run before learned and
  starter rules. M1 sorts all payments at once; M2 sorts each payment with all earlier
  ones (so a transfer's first side cannot see its second yet, the second pairs with it);
  M3's monthly imports sort each month with all months before it. M2 therefore calls
  the engine once per payment over a growing list, so its time grows with the square
  of the payments: 2,880 fake payments took 51 s with the 288 starter rules and 27 s
  with the shop list (brief 13) on the MacBook, without `--groq`.
- An own transfer's built-in category maps to the answer key's `Transfer` (A) or is
  `own-transfers` itself (B). The learning-only baseline keeps the structural rules:
  they are built in, not starter rules.

- A uses every answer-key name as a custom category. A starter prediction maps back
  only when exactly one answer-key category accepts that default id.
- B uses every default id in `category-map.json`, including `own-transfers`, plus
  `Development` and `Trash`. Any id in a payment's acceptable set is right.
- M1 reports coverage (structural and starter rules) and accuracy among those
  sorted, and separately how many were own transfers and how many of those were right.
  Missing predictions are excluded from that accuracy denominator.
- M2 starts with empty learning, walks payments in stable date order, and learns
  immediately from every wrong or missing result. Correct starters do not teach
  the map. Learning always wins. Counts include total fixes, first booking month,
  first 100 payments (or all if fewer), and a learning-only baseline. Monthly
  tables distinguish coverage from correct automatic sorting.
- M3 new-user accuracy uses all payments left open by starters as its denominator,
  including missing/unknown Groq answers as wrong. It never sends known answers.
- M3 replay models one import per month: freeze earlier learning, classify the month,
  send its open payments to Groq (HTTP batches of at most 25), then learn from that
  month's fixes in date order. Compare against a separate replay with the same
  monthly timing and no Groq. This avoids using a later correction in an earlier
  request. M2's immediate-correction count is deliberately reported separately.
- In B, when a correction needs one id from a broad acceptable set, it learns the
  first id in the map. This is a reproducible proxy for an unknown user preference,
  not evidence that the person would choose that particular finer category.
- Confusions include missing answers as `Not sorted`, show names and counts only,
  and are separate for M1, M2, and both M3 paths. No report contains payment fields.

`src/sort/groq.ts` returns per-batch requests, input/output tokens, elapsed seconds,
and a fixed failure code. It never logs. A timeout is 60 seconds per request; 429s
get at most two retries with a bounded delay. Other failed or malformed batches
return nulls, so they count as fixes. Duplicate or unlisted answers also return
null. Reports include failures and mark incomplete token usage/cost as unavailable.
Cost and duration are also shown per payment sent to Groq. They exclude local
sorting and report rendering. Prices are USD estimates, not invoices; unreported
usage on failed requests and provider discounts are not measurable here.

Pricing constants are in `prices.ts`, checked 2026-10-26 against
[Groq's model list](https://console.groq.com/docs/models).
The requested default `llama-3.3-70b-versatile` is preserved. Groq now lists it as
enterprise-only with no public contract price; the $0.59/$0.79 constants are the
historical public rate, explicitly labeled as such. Groq's
[deprecation notice](https://console.groq.com/docs/deprecations) says free/developer
access ended 2026-08-16. Use `--model` for another model; current published rates
are included for GPT OSS 120B, GPT OSS 20B and Qwen 3.8 27B. An unlisted model runs
normally but has no cost estimate.

## Merchant-key limits

Normalization is heuristic, not an identity resolver. It retains umlauts; removes
card/booking metadata, dates, times, long digit runs, legal forms and branch ids;
and strips a finite list of common German city suffixes. Unknown cities stay, so
they may split one merchant into several keys. It does not merge every spelling
variation, such as `dm` versus `dm-drogerie markt` or `REWE` versus `REWE Markt`.

Removing cities/legal forms/numbers can merge independent shops with otherwise
identical names, for example `Café Berlin` and `Café München`. Payments to the same
person/employer/merchant can have different purposes. Each correction replaces
that key's previous choice, so a mixed merchant can require repeated fixes.
Bare PayPal processor entries deliberately return an empty key: they cannot teach
an identity for unrelated sellers. Explicit `PayPal *seller` and `Ihr Einkauf bei`
formats can teach a seller. Other processors, including marketplace counterparties,
can still group unrelated purchases; no starter rule guesses their category.
These are reasons to inspect M2 on the server, not to treat fixture scores as real
accuracy. No real-data validation was done on this Mac.
