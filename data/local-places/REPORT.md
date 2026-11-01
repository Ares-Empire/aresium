# Local places experiment — 1 November 2026

The list is a useful candidate for a further private-data check. It adds 250 correct sorts in the fresh 500-place
sample, with zero new disagreements against OSM kinds. Both the left-out benchmark and the separate full-list
false-match check are unchanged. A gzip asset fits the size and standalone simulator timing targets.
Keep the feature off until Claude has checked Patrik's counts and decided whether to integrate it into the app.

These results do not establish independent accuracy for local names. The known-place sample measures the list's
agreement with its own source, without judges. The frozen judged benchmark supplies the evidence about harm on
unseen places and other payments. OSM omissions, stale tags and unlisted names remain risks.

## Data and size

Source: Geofabrik's complete Germany OpenStreetMap extract, replication timestamp
**2026-10-31 21:23:06 UTC**. Source PBF: 4,873,293,791 bytes; SHA-256 is in `build.json`.
The two passes saw 1,795,532 named records across the queried tag namespaces and 1,201,918 normalised names.
These source counts include unmapped amenities/offices, not just businesses where someone pays.
All 550,669 named ways had their referenced coordinates resolved; 12,222 relations lack resolved geometry and
therefore cannot contribute names to the left-out variant. The NSI/shop exclusion set has 49,238 spellings.

| Variant | Retained OSM records | Names | Name alone | Town required | Location codes |
|---|---:|---:|---:|---:|---:|
| Germany | 264,744 | 223,550 | 205,261 | 18,289 | 16,920 |
| Left-out areas | 249,786 | 216,191 | 199,535 | 16,656 | 16,825 |

Counts are records, not deduplicated businesses. The list requires a usable explicit address somewhere in a name's
group; it does not infer missing towns from buildings or municipal polygons. Detected person names, ordinary or
short names, NSI/shop names and explicitly branded/networked names are dropped. National matching requires one
category and identical classification tags everywhere; unknown occurrences count as conflicts. No dominant-kind
threshold is used. The README documents all rules and the conservative exclusion of entire names from test areas.

| Increment or file | Raw bytes | Gzip bytes | Brotli bytes |
|---|---:|---:|---:|
| Optional matching code added | 4,561 | 1,658 | 1,229 |
| Germany data | 10,503,935 | 3,428,315 | 2,408,592 |
| Left-out data | 10,089,124 | 3,292,557 | 2,310,499 |

The ordinary engine bundle is 506,631 bytes, versus the pinned baseline's 502,070 bytes. Neither data file is
bundled or enabled by default. The candidate app asset is **de.json.gz**, inflated in memory by the host: that
asset plus added raw engine code is **3,432,876 bytes**, below 5 MB. Shipping the raw JSON instead adds 10.50 MB
and misses the target. Brotli is a size measurement only; no Brotli loader is supplied. Raw JSON remains available
for review, evaluation, direct caller loading and ODbL redistribution. An app would package only its chosen full
data asset; the left-out variant and reports are evaluation artifacts.

## Start and first-sort timings

Host: Apple M5, 16 GB, arm64 macOS; Node v26.4.0. Each timing has 20 measured runs after two warmups.
Node uses fresh VM contexts; simulator runs use fresh JavaScriptCore contexts. File reads are excluded.
Medians below are measured totals, rather than sums of separately measured steps.

| Measurement | Baseline median | Optional median | Difference of medians |
|---|---:|---:|---:|
| Node VM startup, JSON already available | 8.47 ms | 40.04 ms | +31.58 ms |
| Node VM startup, gzip inflation + UTF-8 + JSON | 8.47 ms | 76.67 ms | +68.20 ms |
| Node first sort, 500 rendered payments | 15.05 ms | 22.15 ms | +7.10 ms |
| Simulator startup, UTF-8 + bridge + JSON | 17.27 ms | 74.65 ms | +57.38 ms |
| Simulator startup, gzip + UTF-8 + bridge + JSON | 17.10 ms | 91.57 ms | +74.46 ms |

The compressed simulator run's paired added time is **74.45 ms median, 84.26 ms p95, 96.67 ms maximum**.
Its optional startup total is 101.44 ms p95. This is below the +200 ms aim in this harness. The simulator is
`iPhone18,3`, iOS 27.0 build 24A434. `simulator.json` records the gzip run; `simulator-json.json` the raw run;
both contain code/data SHA-256 values. Gzip round trips and those hashes were checked.

Node's median gzip/UTF-8 decode is 13.14 ms. Separately constructed Scripts with distinct filenames take
4.23 ms baseline and 4.08 ms optional; these compilation times are excluded from the Node VM startup rows.
The simulator includes context creation and engine evaluation. It includes the native string bridge and data
load steps; the Node VM excludes bridge serialization. Raw run distributions are in `measurements.json`.

**This is a standalone simulator process, not PhoneEngineTests, a complete app launch or a physical iPhone.**
The app host does not accept this optional list yet. The harness launches no app and reads no app store.
An adopted host still needs its own timing, including file I/O and its chosen caching/bridge strategy.

## Frozen judged benchmark, left-out list only

The baseline has majority labels from the generator and two independent judges. Held-back cases, labels,
disputes and blind batches were not opened. Only evaluation tools consumed those inputs and emitted aggregate results.

| Partition | Total | Disputed, excluded | Right before → after | Wrong before → after | Missed before → after | Correctly unsorted before → after |
|---|---:|---:|---:|---:|---:|---:|
| Worked on | 1,415 | 1 | 934 → 934 | 4 → 4 | 135 → 135 | 342 → 342 |
| Held back, totals only | 622 | 1 | 394 → 394 | 1 → 1 | 82 → 82 | 145 → 145 |

Every prediction is unchanged. This is evidence of no observed harm; it is not evidence of improved coverage in
unlisted towns. Removing entire names is deliberately stricter than removing just their local rows. Full-list
OSM benchmark outcomes are never used to claim improvement. Worked-on detailed scorer output is retained under
ignored `.cache/local-places/left-out.txt`; the bundled-engine report is identical, including all worked-on rows.
Default predictions without a list also match the pinned pre-experiment bundle: **0 changes**.

## Fresh known places

Five hundred source IDs were hash-selected with the fixed fresh seed in `measurements.json`, before rendering or
engine inspection, from 258,197 eligible records outside all eight test areas. They are present in the full list.
The sample uses brief 79's actual renderer and readers, all available bank layouts, case/umlaut changes,
truncations and direct/SUMUP/ZETTLE/PayPal merchant separators. Generic marketplace/delivery wrappers are omitted
because their visible purpose can differ from the underlying venue. Sampling is unweighted and conditional on
retention in the list; it is not a sample of German spending or all OSM venues.

| Outcome against each place's OSM kind | Without list | With full list |
|---|---:|---:|
| Right | 187 | 437 |
| Wrong / OSM disagreements | 10 | 10 |
| Missed | 303 | 53 |

This adds **250 right answers and zero new wrong answers**, while preserving ten existing disagreements.
There are **no independent judges** for this measurement. The remaining 53 are coverage/rendering misses;
their individual failures were not used to tune this experiment. Category/layout breakdowns are in the JSON.

Anonymised examples from the newly sorted sample: “Local place 1” → travel by name; “Local place 2” → eating-out
by name and town; “Local place 4” → household by name and town; “Local place 5” → electronics by name and town.
These are replacement names for actual sampled venues, not additional dataset entries.
Tests also demonstrate made-up “Quarzfunken” by name and “Zur Quarzmühle” with Quarzhausen/Funkendorf resolving
two different categories. Those two invented examples are matcher fixtures, not claims about OSM businesses.

## Wrong answers elsewhere

Both the full and left-out databases give identical outcomes to the baseline on every non-OSM benchmark row.

| Kind, both partitions combined | Scored payments | Wrong without | Wrong with left-out | Wrong with full |
|---|---:|---:|---:|---:|
| Brands | 449 | 4 | 4 | 4 |
| Made-up shops | 250 | 0 | 0 | 0 |
| Non-shop payments | 500 | 0 | 0 | 0 |
| Scenario sides | 40 | 0 | 0 | 0 |

The extra brand dispute is excluded. Held-back information here is aggregate only. No held-back failures were
used for tuning. There are zero new wrong answers in each reported kind and partition.

## Verification and handoff

`npm run typecheck`: pass. `npm test`: **501 tests, 501 passed, 0 failed, 0 skipped**.
`npm run engine`: pass, **506,631 bytes**, Node-built-in rejection enabled.
`git diff --check`: pass. Cache rebuild preserves the JSON SHA-256; both gzip files round-trip exactly.
Source and bundled left-out scorer reports are identical. No commits, pushes, merges, server/database actions or
app edits were made. No genuine payment data was requested, searched for or opened.

Changed files: `.gitignore`, root README, `package.json`/lock; the builder, pure build helper, PBF type declaration,
evaluator and Swift harness under `scripts/`; the measurement-only source override in `scripts/build-engine.ts`;
`src/engine/sorting/local-places.ts`, `sort.ts`, engine exports and matcher tests; the scorer, counts-only private
tool, evaluation tests and README under `eval/sorting/`; and this directory's JSON, gzip, provenance and reports.
The sole added development dependency is `osm-pbf-parser`; engine code has no dependency on it.

Claude still needs to run the two **counts-only** private commands in the README, decide whether any new
disagreement is acceptable under the zero-new-wrong requirement, and choose whether to proceed with app work.
The optional layer follows existing word rules, as well as learning and shops: this preserves every previous
answer, including a disabled-category match. The measurements support this conservative fallback order; they
do not establish that overriding existing word rules would be safe.

If adopted, use the gzip asset and measure the actual host before enabling it. Add **“© OpenStreetMap
contributors, ODbL”**, OpenStreetMap copyright/ODbL links, and access to the distributed derived database to the
app's Fonts & licences page. The database itself carries the notice and source; see the README's licence section.
