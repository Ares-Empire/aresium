# Packed local places — brief 97, 1 November 2026

The packed index retains one 9,779,212-byte block plus **76,200 bytes of Node heap** after GC. It gives the same
complete match results as JSON on **3,413,260 exhaustive payment lookups** over both lists. The data and matching
rules are unchanged. Both JSON paths remain available and the feature stays off by default.

## Files and memory

Host: Apple M5, 16 GB, arm64 macOS, Node v26.4.0. All MB below are decimal.

| Asset | Raw bytes | Gzip bytes |
|---|---:|---:|
| Germany packed | 9,779,212 | 3,281,615 |
| Left-out packed | 9,409,504 | 3,154,308 |
| Germany JSON, unchanged | 10,503,935 | 3,428,315 |

The full packed database contains 223,550 names, 16,920 town codes, 21 categories and 509,522 town/category pairs.
The left-out list contains 216,191 names and 481,651 pairs. Every pair is retained, including national-category
names whose location can override the national answer. The raw packed file SHA-256 values and all independent
process measurements are in `packed-measurements.json`. Only compressed database assets are tracked.

| Loaded after GC, incremental bytes | JSON | Packed |
|---|---:|---:|
| `heapUsed` | 46,064,512 | 76,200 |
| `arrayBuffers` | 0 | 9,779,212 |
| `external` (includes `arrayBuffers`) | 38,994 | 9,818,206 |
| RSS | 87,605,248 | 10,125,312 |

Three fresh `node --expose-gc --import tsx` processes per format, alternating order. Every snapshot follows three
explicit garbage collections. The baseline contains the same 500 already-prepared fictional payments, with
public-list merchant names and invented amounts. Temporary read buffers/JSON source strings leave the loading
function before collection. Figures are medians of independent process deltas from their own baseline. Packed
heap deltas range from 75,936 to 76,288 bytes. No package was added. The measurement command checks that retained
packed heap and any extra ArrayBuffer storage stay within 300 KB of the raw buffer budget.

After timed lookups and sorts, packed `arrayBuffers` still increases by exactly 9,779,212 bytes: no table or
per-name decoded cache accumulates. Heap then increases by 877,240 bytes, including shared matcher/regex/JIT
warmup (JSON's post-lookup heap rises by a similar additional 781,288 bytes). After clearing both the installed
list and caller reference and collecting, the packed `arrayBuffers` delta is **0**, `external` is 38,994 bytes,
and heap is 771,560 bytes above baseline. JSON's released heap delta is 715,488 bytes. These remaining heap
figures include runtime warmup and do not represent retained list entries.

RSS remains about **90.29 MB** above baseline for packed and **160.92 MB** for JSON after sorting and release.
This is allocator/runtime retention, not a live-buffer count; neither Node RSS nor these heap counters establish
the app's JavaScriptCore loaded/released process-footprint gates. The next app brief must remeasure both gates,
including native inflation, ownership and release, on the actual app host; physical-device memory is unmeasured.

## Loading and lookup time

| Median | JSON | Packed |
|---|---:|---:|
| Raw file read (including UTF-8 conversion for JSON) | 4.16 ms | 0.89 ms |
| JSON parse / packed validation and index creation | 37.39 ms | 24.38 ms |
| Total raw read and load | 41.99 ms | 25.37 ms |
| `findLocalPlace`, per payment | 8.88 µs | 8.50 µs |
| Full sort, per payment, batch of 1,250 | 15.84 µs | 16.89 µs |
| Full sort, per payment, batch of 5,000 | 12.90 µs | 13.43 µs |

Load samples are the first load in each fresh process, reading raw files from the warm filesystem cache. Packed
loading includes a checksum over the entire file and validation of UTF-8, ordering, offsets and references.
It excludes gzip inflation, engine evaluation and the native bridge. Each timing column is its own median;
component medians need not sum to the median total. Lookup/sort samples have two warmups and ten measurements
per process and size, then a median across processes. The same 500 payments contain names, names with towns,
ambiguous names and fictional misses; larger sort batches repeat that workload. These figures characterize this
workload and do not establish a general speedup or JavaScriptCore timings.

Reproduce with:

```sh
npm ci
npm run local-places -- --pack-only
npm run measure:local-places-packed
```

## Equality and evaluation

`npm test` round-trips every column in both compressed assets and verifies deterministic regeneration, Unicode
byte ordering (including supplementary characters), empty tables/towns, in-place aligned byte slices, corrupt
buffers and wrong versions, ambiguous towns/collisions, national-category overrides, opt-in/replacement/release,
and foreign-realm native-style buffers in the engine bundle without TextEncoder/TextDecoder. Existing matcher
and sorter tests remain in place.

The exhaustive lookup comparison is separate from `npm test` because it takes minutes:

```sh
npm run check:local-places-packed
npm run eval:local-places -- --packed
```

| Exhaustive comparison | Names | Town pairs | Payment lookups | Differences |
|---|---:|---:|---:|---:|
| Germany | 223,550 | 509,522 | 1,752,116 | 0 |
| Left-out | 216,191 | 481,651 | 1,661,144 | 0 |

Every name is checked alone. Every pair is checked in a merchant suffix, in the description, and in an explicit
card location field. The compared result includes category id, matched name and the town-evidence flag, including
null/ambiguous outcomes. This run took 91.61 s and 56.97 s respectively (other checks ran concurrently).

`packed-evaluation.json` records **zero changed predictions** between JSON and packed for the left-out judged
benchmark, the full-list comparison, the 500 known places, and their direct local matches. The unchanged JSON
matcher/sorter/exports from checkout commit `641c773951284ef392d975ed2ab114ee43036719` were independently bundled
and checked too: **zero changes** in every comparison. Source JSON, source packed and bundled packed left-out
scorer reports are byte-identical.

The same known-place sample has source-id hash
`39c076a462e5b6fe652b0fb6b47d2ad39dffbd2a3350ee3831e1ee45c66eaa6e` and pool size 258,197. On this checkout it
scores **191 right / 12 wrong / 297 missed** without the list and **436 right / 12 wrong / 52 missed** with either
format. These are not brief 86's historical 187 / 10 / 303 and 437 / 10 / 53: the checkout already includes
brief 96's sorting changes. The independent original-checkout comparison confirms that this difference predates
brief 97; this brief did not adjust rules to restore historical counts.

With the left-out list, both formats leave the judged benchmark unchanged: worked-on **971 right, 2 wrong,
100 missed, 342 correctly unsorted** (one dispute excluded); held-back **403 right, 1 wrong, 73 missed,
145 correctly unsorted** (one dispute excluded). Held-back inputs/examples remain unopened; only evaluation tools
consume them and report aggregate counts. No private payments were requested, searched for, or read.

## Checks and handoff

`npm run typecheck`: pass. `npm test`: **522 tests, 522 passed, 0 failed, 0 skipped**.
`npm run engine`: pass, **524,873 bytes**, with Node-built-in rejection enabled.
`git diff --check`: pass. The original JSON gzip files are unchanged.

Changed: engine packed reader, shared local-place matcher, sorter and exports; packed/host tests; build-time packer,
builder's full/pack-only output, exhaustive comparison, memory measurement and evaluation scripts; evaluation
file loader/private-tool input types; package scripts and ignore rules; both packed gzip assets and this directory's
new reports/documentation. No commit, push, merge, deployment, server/database action or app modification.

Exact changed-file inventory:

- `.gitignore`, `package.json`
- `src/engine/index.ts`, `src/engine/sorting/local-places.ts`, `src/engine/sorting/local-places-packed.ts`,
  `src/engine/sorting/sort.ts`, `src/engine/local-places-packed.test.ts`
- `scripts/build-local-places.ts`, `scripts/local-places-pack.ts`, `scripts/check-local-places-packed.ts`,
  `scripts/measure-local-places-packed.ts`, `scripts/eval-local-places.ts`
- `eval/sorting/local-places-file.ts`, `eval/sorting/own-data.ts`
- `data/local-places/README.md`, `data/local-places/REPORT.md`, `data/local-places/PACKED-REPORT.md`,
  `data/local-places/packed-measurements.json`, `data/local-places/packed-evaluation.json`,
  `data/local-places/de.places.bin.gz`, `data/local-places/left-out.places.bin.gz`

The [README](README.md#native-host-contract-for-the-next-app-brief) specifies the host API and ownership contract:
native inflation into stable bytes, JSC `JSObjectMakeArrayBufferWithBytesNoCopy`, then one actual-buffer call to
`AresiumEngine.setLocalPlaces(buffer)`. Later sorts pass only `localPlaces: true`. Clear with
`AresiumEngine.setLocalPlaces(null)` and release all host JS references so the native deallocator can run.

Claude must run the JSON-versus-packed **counts-only private comparison**, including the replay, outside all
repositories (the last two commands in the README's private-data instructions). The outputs must be identical.
Keep the JSON path until that server-side comparison passes. App adoption and JavaScriptCore memory measurements
remain for the next brief; the current Node measurements satisfy the packed index's retained-size target only.
