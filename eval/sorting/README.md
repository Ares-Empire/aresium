# Automatic sorting evaluation

**30% is held back. Later sorting-improvement briefs must not open `cases.heldback.jsonl`,
`labels.heldback.jsonl`, held-back disputes, or the original blind batches.** Run the scorer to see aggregate
held-back results only. Do not use held-back failures to tune the engine, rules, names or category guide.
Only Claude/Patrik and the independent baseline judges may inspect held-back cases during initial adjudication.

This is a frozen, invented-payment benchmark of first-use sorting in Germany. It measures the engine; it changes
neither the engine nor its shops, rules or learning bench. Local businesses and chain brands supply independent
business-type facts. All amounts, payment dates, account numbers, private people, employers and landlords are
invented. There are no genuine bank transactions. Only personal-name words inside local OSM names are
pseudonymised. `person-names.json` contains the manually compiled multilingual first/surname vocabulary and a
separate replacement pool. `person-names.ts` recognises names, titles, owner markers and possessives; word-like
surnames require ownership/name context. Business wording, foreign words, imagery, streets and places remain as
OSM prints them, and exact NSI brands remain unchanged. Replacements use natural first names and plausible invented
surnames, never an original word from that place name. This is a reviewable heuristic, not exhaustive name detection;
extend the vocabulary/context tests when review finds an omitted name or an ambiguous business phrase.
`name-hints.ts` measures lexical business/cuisine hints without using source tags, engine answers or brand recognition.

## Answers and review

`categories.md` was written first from the default category names and common sense. **Claude reviews it before
judging starts.** `mapping.ts` implements its independent OSM/NSI taxonomy. NSI is pinned to the version and SHA-256
in `scripts/build-shop-list.ts`; the engine shop list is used only for exact normalised-name membership, never to
assign a correct category. A name can be unknown to this membership check and still match an engine word rule.

Each `cases*.jsonl` line has an opaque stable `id`, a single `payment`, `kind`, `rendering`, source `facts` and a
`generator` first answer. `best` and `alsoRight` name category IDs, `unclear` means the visible purpose cannot be
known, and `personal` means context/preferences matter. Both flags permit unsorted; named categories can also be
right. A marketplace prefix that conceals a specialist seller gets a marketplace answer, not the hidden shop type.
OSM source tags may be more informative than a bank line: blind disagreement should expose that, not be suppressed.

Until both judges have run and been merged, the scorer explicitly says **PROVISIONAL: first answers alone**.
These initial numbers are a development baseline, not a claim of independently validated accuracy.

```sh
npm run eval:sorting -- --batches
# Claude first reviews categories.md. Copy only these files to EACH empty judging folder:
# judging/batch-[0-9][0-9].jsonl, judging/JUDGING.md, judging/categories.md
# Run a Claude judge and a separate Codex judge. No repo or other judge access.
npm run eval:sorting -- --merge /outside/judge-1.jsonl /outside/judge-2.jsonl
npm run eval:sorting
npm run engine
npm run eval:sorting -- --engine dist/aresium-engine.js
npm run eval:sorting -- --record
```

The supplemental batch-12-rerendered.jsonl contains only payments changed by the delivery-wrapper rendering fix;
rerendered-ids.txt lists their IDs. Use this batch alone for selective rejudging, then replace those IDs in each
complete judge answer file before merging. Do not combine the supplemental batch with the full numbered batches.

The batches are shuffled, about 200 cases each, and contain only opaque IDs, app-visible payment fields and (for
scenarios) the other visible payments in `context`. A scenario's sides may be in separate batches; the context is
repeated so neither judge needs hidden scenario facts. `judging/manifest.json` stays with the operator, not the
judges, and binds the merge to the exact corpus. Answers cover every ID exactly once; missing/duplicate/unknown IDs,
unknown categories, empty answers, extra fields and stale batches fail the merge. Judge output files stay ignored
until Claude decides how to archive them. Regenerating a smaller corpus removes obsolete batches.

A category needs two of three votes (generator + judge 1 + judge 2), whether best or alsoRight. Unsorted needs two
unclear/personal votes. A case without either majority is disputed and excluded from scoring. `labels.jsonl` and
`labels.heldback.jsonl` contain accepted sets, unsorted permission case fingerprints and an explicit `basis` (generator or majority). Generation initialises separate provisional label
files; it never overwrites majority labels. Changes invalidate judged labels.
`disputed.jsonl` and `disputed.heldback.jsonl` include the votes for adjudication. `agreement.json` gives counts and
rates per kind: `allThree` means all share at least one accepted outcome (including unsorted); `twoOfThreeOnly`
means a majority exists without a common three-way outcome; `exactSets` is the stricter identical-outcome-set count.
A majority can accept several categories even if there is no single shared three-way category.

## Generation and sources

```sh
npx tsx eval/sorting/make.ts
npx tsx --test eval/sorting/*.test.ts
```

Generation is explicit; normal scoring never downloads or rewrites cases. It uses Node fetch with sequential
Overpass queries (one per place, 2.5-second pauses; errors pause before a fallback endpoint). Raw responses are
cached under ignored `.cache/`; never commit them because they can contain public business contact/person tags.
The committed source facts retain only classification tags and pseudonymised names. Cached inputs + the fixed seed
reproduce the same bytes. Fresh OSM downloads can change the corpus: freeze/retain the cache externally if a full
rebuild is needed. `sources/manifest.json` records bounding circles, counts, layouts, pinned NSI and the corpus hash.
`sources/LICENCE.md` covers OSM's ODbL and NSI's BSD terms. This dataset is a derived OSM database under ODbL.

Local cases come from Garching, München Schwabing, Köln, Berlin Kreuzberg, Leipzig, Hamburg, Wernigerode and Wacken.
The circle names describe sample centres, not precise municipal boundaries. Food/everyday venues receive four times
the selection weight of rare venue types; this is a deliberate coverage sample, not a population spending estimate.
NSI sampling takes 210 known and 210 unknown independently tagged brands; 30 authored service cases bring brands to
450. The fictional shops include descriptive, opaque and misleading names plus 20 second-rendering twins. There are
500 non-shop cases and 20 two-payment scenarios. Scenario families and robustness twins share an ID stem.

`render.ts` uses all known CSV layouts present in the bank fixtures, plus PayPal DE/EN, CAMT and MT940. It fills
synthetic rows and passes them through the existing readers; no parallel approximation of counterparty/description
placement is used. The raw synthetic row is preserved as the app sees it. Formatting includes uppercase, umlaut
variants, truncation, branches, terminals, towns, dates, booking kinds and payment-service wrappers. These are
representative synthetic renderings, not evidence that every terminal uses every bank layout.
Delivery prefixes require an eating-out or coffee-snacks answer; Wolt and Uber Eats also permit groceries and
health with explicit pharmacy evidence. Only invalid delivery selections are redrawn, using the same seeded index
over the remaining eligible services; all valid selections stay unchanged. PayPal exports use
the actual name/type description behaviour, with seller names rather than bank/card processor prefixes. Scenario rows use normalised app fields directly so their ownership
and duplicate-purchase evidence is controlled.

Add a case by changing the independent source/mapping or invented examples in `make.ts`, then regenerate, inspect
worked-on cases and rejudge new/changed cases. Do not select or label examples based on the engine's success.
Case IDs use source identity/seed, not the answer. Stable SHA-256 of the ID stem selects roughly 30% held back;
scenario sides and twins always stay together to prevent context/rendering leakage. This family exception to
hashing the entire ID preserves the intended independent holdout. Existing ordinary case membership is stable.

## Reading scores

Headlines count payments, including scenario sides. `sorted = right + wrong`; disputed rows are separate and
excluded from `total`. `missed` means unsorted where a category exists and unsorted was not accepted.
`unsorted-right` means unsorted with an unclear/personal majority. A personal case sorted to an accepted category
is right; sorted to any other category is wrong. Wrong has its own headline because errors matter more than gaps.
The scorer prints counts by kind, brand membership, money direction, and service in both partitions. Category
breakdowns and every wrong/missed payment appear only for the worked-on part. Category rows overlap when accepted
sets contain several categories. All groups and breakdowns exclude disputed cases in the same way.

All ordinary payments are sorted in one fresh-person call, with all defaults chosen and no learned rules. Each
scenario has its own call. This intentionally exposes the engine's collection-wide PayPal assumptions when a
benchmark contains bank PayPal lines and PayPal exports together. Scenario groups additionally score as a unit:
all sides must be right or acceptably unsorted; any wrong side makes the group wrong, otherwise any missed side
makes it missed. A disputed side excludes the entire group from that group score. These group counts do not
replace payment-level headlines. Robustness twins share a partition; compare their worked-on rows when tuning.

`--record` appends one row under an exclusive lock to `eval/history.csv`. Sorting CSV columns (shared with brief 78):
`date,commit,suite,worked_total,worked_disputed,worked_sorted,worked_right,worked_wrong,worked_missed,worked_unsortedRight,heldback_total,heldback_disputed,heldback_sorted,heldback_right,heldback_wrong,heldback_missed,heldback_unsortedRight`.
If brief 78 created different columns first, the writer retains them and their rows, adds the sorting columns,
and leaves unrelated cells empty. Malformed CSV fails without changing it. Dates are UTC; commit is HEAD (uncommitted baseline work is
not separately identified, so Claude should record again after committing). `suite` is `sorting`; brief 78 uses
`files`. Capture the scorer's provisional/majority status alongside a history run; CSV numbers alone do not prove
independent judging occurred.

## Private export: operator only

```sh
npx tsx eval/sorting/own-data.ts /outside/all/repos/Aresium-export.json
```

Claude runs this with Patrik's export; a coding agent must never request, locate or open that data. The tool refuses
paths inside this worktree, symlinks into it and multiply linked files. Keep exports outside all repositories.
It reads the `LedgerExport` schema 1–6 shapes (`text`, `bookingDate`, chosen categories and account IBANs), ignores
stored learned rules, and sorts with the chosen list. Schema 4 display names do not affect sorting. It validates
fields used for evaluation, not receipt/restore metadata. Output contains counts only: manual-category agreement,
non-manual retained-category agreement (including receipt-assigned categories), sorted/unsorted, a confusion table
with default IDs/custom numbered aliases, and chronological learning replay. Uncategorised originals are counted
but supply no answer/correction. Replay sorts each prefix, then learns a correction just as `bench/run.ts` does;
months are numbered, never dated. Structural rules can require repeated fixes. No text, private category name,
amount, date, account, IBAN or parser exception is printed, even on errors. No report file is written.
