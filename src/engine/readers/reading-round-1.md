# Reading bank files, round 1

Worktree: `aresium-85-reading-round-1`. No commits, recording, fixture regeneration, app changes, server access or
real bank data. The 228 checked-in evaluation cases and their answers were not changed.

## Evaluation after each change

Each row was measured with `npm run eval:files -- --json`. The final source and JavaScriptCore bundle agree.
"Review rows" means wrong payments after confirming the first offered layout. Ids are payment/id associations,
not merely id strings found somewhere in the result.

| Change | Right | Correct refusals | Unexpected refusals | Wrong files | Silent rows | Review rows | Ids kept, files / 159 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Before | 179 | 7 | 5 | 37 | 40 | 54 | 123 |
| Recognise known columns after separator changes | 188 | 7 | 0 | 33 | 86 | 6 | 133 |
| Whole-column dates, number rewrites, profile-preserving date confirmation | 211 | 7 | 0 | 10 | 12 | 6 | 156 |
| Refuse empty or mostly unreadable tables | 211 | 8 | 0 | 9 | 12 | 6 | 156 |
| Refuse broken quoting and structurally short payment rows | 211 | 12 | 0 | 5 | 3 | 6 | 156 |
| Refuse additional payment sections or accounts | 211 | 14 | 0 | 3 | 0 | 5 | 156 |
| Purpose/type selection; refuse planning tables and unresolved currencies | 211 | 16 | 0 | 1 | 0 | 1 | 156 |
| Decode Latin-15's euro | 212 | 16 | 0 | 0 | 0 | 0 | 156 |
| Preserve the legacy VR formula through new date confirmations | 212 | 16 | 0 | 0 | 0 | 0 | 156 |

The separator change initially moved bad spreadsheet readings from the confirmation route onto the automatic
route. The following date/number change fixes that cause; the intermediate state must not ship separately.

Final review added tests for evidence beyond the former 200,000-character detection prefix, contradictory date
orders, PayPal separators and damage, short unreadable rows, and C24 account names. Headline scores stayed the same.
Original id values present improved from **359/453** before to **444/453** after. Files needing confirmation went
from **80** to **59**. Both existing partial readings still return their intact payments and `skipped: 1`.

## Frozen fixtures

All **46 inputs and 46 `.expected.json` files are byte-for-byte unchanged**, checked against hashes taken before
editing. Forty-five fixture results still match their complete frozen answers, including every payment id.

The one intentional behavior exception is `comdirect.sections.csv`: the old answer returned the three Girokonto
payments, omitted both Visa payments, and called the remaining section skipped. It now throws `unknown` instead.
The regression and shared-layout tests explicitly assert that refusal, including in the bundle. The old answer
stays intact for Claude's review; it was not regenerated or silently accepted as correct.

## Ids and limits

The three remaining id-only evaluation failures are `volksbank--excel-short.csv`, `volksbank--excel-iso.csv` and
`volksbank--excel-us.csv`. Each reads all four payments correctly, but retains only one original id. The legacy VR
hash uses the amount's original spelling after its permissive number conversion: `1800`, `-3.2` and `-36.40` remain
different spellings from a spreadsheet's `1800.00`, `-3.20` and `-36.40`. The repeated coffee's occurrence id also
changes when its base hash changes. Recovering the lost spelling from the rewritten file is impossible in general.
Canonicalising the native formula would change existing import ids, so it is deliberately unchanged.

New ambiguous VR date confirmations carry `idStyle: "vrbank"`. This opt-in retains the native hash fields, raw
amount precision, purpose spacing and occurrence numbering when only dates/separators changed. Existing saved
layouts without that field keep their generic hash formula. Tests cover JSON round trips and the bundle. The
server's VR parser remains in place and unchanged. Invalid date/amount rows are filtered before it can invoke its
date fallback, with the skipped count from the strict table reader.

Documented native slash-date formats remain trusted bank contracts so existing imports keep their interpretation
and ids. Rewritten slash dates without evidence above 12 require confirmation of either order; US order is offered
first for that spreadsheet rewrite. Unknown files retain their existing preview order, but row ordering no longer
removes their date uncertainty. Contradictory readable formats refuse rather than drop some dates.

Latin-15 selection uses A4 without Windows C1 punctuation as evidence for the euro. An unmarked Latin-1 generic
currency sign has the same byte and cannot be distinguished absolutely. UTF-8 and exports with Windows euro or
punctuation retain their existing decoding. Similarly, CSV syntax cannot prove truncation within a final unquoted
cell if the resulting record still has all its columns and valid required values.

## Checks and handoff

- `npm run typecheck`: pass.
- `npm test`: **481 passed, 0 failed, 0 skipped**, including evaluation tests.
- `npm run engine`: pass; the bundle has no Node built-ins.
- Source and bundled `eval:files`: **212 right, 16 expected refusals, 0 unexpected refusals, 0 wrong files;
  0 silent rows, 0 review rows; ids kept in 156/159 files**.
- `git diff --check`: pass.

Claude must review the deliberate comdirect refusal and decide whether to update that one obsolete frozen answer.
Before merging, run existing-import parity checks on native VR exports under Claude's control: dates, signed
amounts, descriptions, counterparties and external ids, including repeats. This worktree used invented data only.
Check that the app preserves `idStyle` when saving a confirmed layout; the engine JSON/bundle round trip passes,
but the app is outside this brief. Any solution for numeric-spelling duplicates needs an explicit compatibility or
alias strategy; it must not replace existing ids. Claude records the score after merging.

## Files changed

- `src/engine/readers/bank-profiles.ts`, `csv.ts`, `decode.ts`, `guess.ts`, `profiles.ts`, `read.ts`, `readings.ts`,
  `table.ts`, `types.ts`, `values.ts`, and this report.
- `src/engine/reading-round-1.test.ts`, `bank-readers.test.ts`, `readings.test.ts`, `shared-layout.test.ts`.
