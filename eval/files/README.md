# Bank-file evaluation

This is a measurement set, not a reader fix. All payments, people, account details and amounts are invented.
Real bank headers come from the existing synthetic fixtures and their documented profile sources.
Nothing reads a database, server or private export.

The default seed, **78**, produces **231 cases**: 162 format-only derivatives of 44 existing files, 30 unknown
bank layouts, six explicit encoding samples, 12 sign/amount conventions, three difficult purpose texts,
16 files that must be refused, and two partial readings with an explicit skipped-row warning.
CAMT and MT940 are included alongside the CSV banks. The case bytes and answer manifests are checked in.

## Run

```sh
npx tsx eval/files/make.ts
npm run eval:files
npm run engine
npm run eval:files -- --engine dist/aresium-engine.js
npx tsx --test eval/files/*.test.ts
```

The score reads the checked-in cases; it does **not** regenerate their answers. `make.ts` imports no engine
code. The generator uses the existing `csv-parse` package and native text decoding independently of the
reader's CSV parser and decoder. No new packages are needed.

`make.ts --seed 78 --out eval/files/out/another-set` reproduces the same bytes in another directory. A different
32-bit unsigned seed changes invented amounts and shuffled columns. Keep the default seed for comparable runs.
Generation overwrites its named files, preserving unrelated hand-added cases. If removing or renaming a generated
case in code, remove its previous data file and manifest explicitly. Tests verify that regenerating seed 78
reproduces every checked-in byte.

`npm run eval:files -- --json` also writes `eval/files/out/latest.json`, including every row difference.
That directory is ignored. Standard output includes both tables and every failing file, with at most three
row differences per file and long text clipped to 160 characters. Evaluation failures are expected measurements
and exit successfully; invalid manifests, missing files, invalid CLI arguments and broken bundles exit nonzero.

## Where answers come from

Every `.case.json` declares one of three provenance methods:

- **`original`**: the original `.expected.json` supplies date, signed integer cents, currency, counterparty,
  purpose text and original payment ids. The manifest names that fixture and reference and stores the reference's
  SHA-256 hash. Only representation changes are made: encodings, line endings, separator/quoting, extra empty
  columns/rows, preamble/total lines and spreadsheet date/amount styles. These derivatives are deliberately held
  to the frozen reference even when the reader now fails. These original references are inherited regression
  answers, originally produced by a reader; this brief explicitly accepts them as the reference for format-only
  changes. They do not independently prove that the original export was read correctly.
- **`construction`**: integer-cent payments and their text exist **before** dates, amounts, headers and reordered
  CSV cells are written from them. The reader never supplies an answer. This includes the 30 invented unknown
  bank layouts, accented text in each encoding, debit/credit and S/H conventions, trailing minus, currency suffixes,
  and the difficult N26 text cases. Payment text folds whitespace; the raw multiline CSV remains multiline.
- **`hand`**: a short reason states a required refusal and its error code, or the exact intact payments and
  required `skipped` count for a partial reading. `unknown` is the existing generic error code chosen for damaged
  files, ambiguous currencies and multiple accounts: those conditions currently have no specific error code.
  An uncoded crash does not pass as a correct refusal.

The two original unknown-bank fixtures are replaced by constructed unknown-bank cases, so a frozen empty
`transactions` array does not become their answer. The existing `comdirect.sections.csv` reference describes only
the first account; its format-only derivatives are excluded. Instead a hand case requires refusal of this
multi-account file. `BankFile` currently represents a single account, so importing the first section and omitting
the second is unsafe. A future multi-account API could justify an explicit review of that expectation.

Latin-1 cannot encode a euro symbol: its constructed case uses literal `EUR`. Windows-1252 encodes `€` as `0x80`,
Latin-15 as `0xa4`, and both retain umlauts and ß. The generator never silently replaces an unrepresentable character.
An encoding not able to represent every character in an original is replaced by UTF-8 with BOM and labeled as such.
Legacy bank layouts, rather than invented bank headers, remain the basis for all known-bank derivatives.
The renamed XLSX case is a minimal valid OOXML ZIP workbook; the renamed PDF is a minimal PDF with an xref table.

## What the score means

Each file has exactly one status:

- **right**: every expected payment field and any required skipped-row warning agree;
- **refused as expected**: the exact declared error code was thrown;
- **refused unexpectedly**: a readable case was refused, the code differed, an uncoded exception occurred, or the
  guess was incomplete;
- **read wrong**: the reader returned missing, extra or incorrect payments, omitted a required warning, or read
  a file whose answer requires refusal. Returning an empty successful import can still be wrong.

Unknown CSVs normally stop at `needsLayout`. The score never picks a layout using the answer key or tries alternative
readings. It confirms the **unchanged first guess**, when complete, and reads the **whole file** using it. The report
marks this route as **layout confirmation**. Those results describe what happens if the person confirms that preview;
they do not claim the app imported an unconfirmed guess. An incomplete guess is a safe stop, counted as an unexpected
refusal, with zero silent row errors. Even for a must-refuse case it is not counted as the required coded refusal.

The report therefore shows three row totals:

- **Rows silently wrong**: wrong/missing/extra payments returned automatically, with no thrown error and no layout gate.
- **Rows wrong behind layout confirmation**: the same defects after confirming the first guess.
- **Total wrong rows in non-error readings**: the sum, for comparison with the brief's broad definition of rows
  returned without an error. The first number must reach zero; wrong proposed readings should also reach zero.

A payment compares date (calendar day), exact signed cents, currency, counterparty and purpose text. Sub-cent
values are never rounded into a correct answer. Account balances, value dates, IBANs, bank identification and raw
records are outside this score. A row with several incorrect fields counts once. Exact payment occurrences are
matched first, irrespective of order; duplicate multiplicity matters. Remaining rows are paired by closest field
agreement, then unmatched missing/extra rows each count once. This avoids a missing first row shifting all later
comparisons. Completely replaced rows cannot be distinguished from simultaneous deletion/insertion without an
independent bank reference, so a paired replacement counts as one incorrect row. For a must-refuse file, every
returned payment counts as extra. An empty successful response to such a file is a file failure with zero row errors.

Re-import is measured independently of file status. For each format-only derivative, the original payments and ids
define a multiset of `(payment, externalId)` pairs. All those pairs must agree to mark the file's ids **kept**;
reordering is allowed and swapped ids fail. The report also counts original id **values present**, with duplicates
counted separately. A wrong payment can retain an original id value, so these two measures deliberately differ.
Refused derived files remain in the denominators. An id-only failure leaves its payment reading status **right**
and appears in the failing-file list. No id-generation behavior is changed here.

## Record and compare

```sh
npm run eval:files -- --record
npm run eval:files -- --engine dist/aresium-engine.js --record --json
```

`--record` appends exactly one data line to `eval/history.csv`, creating it with this suite-neutral header:

```csv
date,commit,suite,metrics
```

The fields are UTC ISO timestamp, current checkout git commit (`-dirty` when there are local changes), `files`,
and a quoted JSON object containing every headline count. Brief 79 can append `sorting` with its own metrics in
the same last cell. Existing rows are preserved; an incompatible header is rejected rather than overwritten.
Claude should reconcile this shared schema with brief 79 when merging. The git column identifies the checkout;
when scoring an externally supplied bundle, preserve its identity separately (`--json` records the supplied path).
Do not mistake a historical bundle's score for the checked-out source score.

Compare scores only over the same seed and answer set. The commit identifies the checked-in corpus. Adding a new
case or deliberately revising an expectation changes that measurement set; explain it when comparing history.

## Add a case

1. Add a generation rule in `make.ts`, with the correct provenance and one sentence describing the real-life
   situation. Write invented payments first for new layouts. For a refusal, explicitly choose the desired error
   code and explain why. A partial reading must state exactly which payments survive and its skipped-row warning.
2. For a representation-only derivative, copy the frozen original payment fields and ids; keep the source reference
   and hash. Verify that the transformation preserves the cells' meaning. Never run the reader to manufacture
   expected answers. Do not copy private data or touch `src/engine/fixtures/`.
3. Regenerate and inspect both bytes and `.case.json`. A hand-authored data file plus a manifest with the same
   schema also works; a distinct filename keeps it out of the generator's overwrite set. Regeneration tests must
   then account for the deliberately hand-added file, or add it to the generator instead.
4. Run the score and investigate differences without changing the answer to agree with today's reader.
5. Run `npm run typecheck`, `npm test`, `npm run engine`, and `npx tsx --test eval/files/*.test.ts`.

The extra tests cover good readings, exact refusals, each critical field, missing/extra/duplicate rows, id-only
changes, swapped ids, layout confirmation, warnings, bundle loading, malformed inputs, CSV history and seeded
generation. `npm test` currently covers only `src/`; Claude will add `eval/` after merging both evaluation briefs.
No server parity check is needed for this measurement-only change. Future reader or id fixes still need Claude's
existing-import and real-data checks before replacing any legacy path.
