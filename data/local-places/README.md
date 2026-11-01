# Optional German local places experiment (brief 86)

Off by default. Neither generated list is imported into the engine bundle or enabled in the app.
`de.json` is the full experimental list; `left-out.json` is its evaluation variant. The builder also produces
deterministic `.json.gz` files. The candidate app asset is now `de.places.bin.gz` (brief 97), inflated by the native host into one byte block.
The engine searches typed-array views on that block. The JSON assets and matching path remain available for
comparison. Neither path contains a decompressor or Node dependency. See the packed layout and host contract below.
`build.json` records the extract's replication timestamp, SHA-256, source bytes, filtering counts and pinned NSI.
`measurements.json` contains aggregate measurements; `REPORT.md` explains the result.

## Rebuild and measure

```sh
npm ci
npm run local-places             # cached facts, or download/parse Germany on the first run
npm run local-places -- --fresh  # download a new extract and replace the ignored parsed cache
npm run eval:sorting
npm run eval:sorting -- --local-places data/local-places/left-out.json
npm run eval:sorting -- --engine dist/aresium-engine.js --local-places data/local-places/left-out.json
npm run eval:local-places
npm run local-places -- --pack-only  # pack the committed JSON gzip snapshots, without downloads or source changes
npm run check:local-places-packed    # exhaustive lookup parity; about three minutes on the measurement Mac
npm run eval:local-places -- --packed # same evaluation plus JSON/packed and original-checkout parity; separate report
npm run measure:local-places-packed # fresh --expose-gc processes; requires raw files from --pack-only or a full build
```

Rebuild about twice a year. The first build downloads roughly 5 GB from Geofabrik. Raw PBF, parsed source facts,
NSI, temporary bundles and logs stay under ignored `.cache/local-places/`. Keep that cache to reproduce an exact
snapshot; fresh OSM downloads change it. No database, server, bank data or app project is involved.
The sole new development dependency is `osm-pbf-parser@2.3.0`; it is used only in `scripts/`.
Two streaming passes collect named POIs and resolve their way-node coordinates. Relations are retained as
classification evidence but lack resolved geometry; their entire names are excluded from the left-out variant.

## Format and decisions

The JSON is a sorted table with category and location dictionaries. Each row is
`[normalisedName, nationalCategoryCode, [townCode, categoryCode, ...]]`.
A national category code of `-1` requires a location. Locations are explicit `addr:city`/town/village or postcodes;
the builder does not guess a town from a nearby centroid. Names without any usable address are classification
evidence but do not contribute standalone rows. Counts are OSM records, not deduplicated physical businesses.

Classification uses the independent `eval/sorting/mapping.ts` table, including its uncertainty and personal flags.
Name-only matching requires unanimous mapped category **and identical classification tags** across Germany:
there is no dominant-majority exception. Unknown/unmapped occurrences block name-only matching too. Different
kinds can still resolve to the same category within a town. Conflicts within a location remove that location.
All occurrences participate before address, safety, chain or geographic filtering. All NSI names worldwide,
aliases and shop-list names are excluded, as are explicitly branded/networked places and detected person names.
Person detection reuses the evaluation heuristic; it is not an exhaustive detector.

`safeLocalName` is the safety word list and length rule. All names need at least eight letters;
ordinary words/phrases and known banking/processor words are rejected. This deliberately drops useful names too
(for example “Lieblingsstück”). Umlauts use ae/oe/ue; plain-vowel terminal spellings have no guessed aliases.

The engine accepts `sortPayments(payments, { categories, learned, localPlaces })`, using a JSON-parsed list,
an `ArrayBuffer`, a 4-byte-aligned `Uint8Array` slice, or the result of `indexLocalPlaces(buffer)`.
The JSON table is searched directly. Packed buffers are validated once and weakly cached by input identity;
the index contains only views on their original buffer. No strings or objects are retained per name or town.
`setLocalPlaces(buffer)` additionally installs an index in this engine context; `localPlaces: true` opts a sort
into that installed list. Loading alone does not enable it, and `setLocalPlaces(null)` releases it.
Structural transfers, learning, explicit purposes, shop names **and existing word rules** precede this fallback.
Preserving existing answers is a conservative departure from the suggested local-before-words order: this
experiment measures whether local knowledge can fill gaps without changing an answer already made by round 1.
A match whose category is disabled stays unsorted. Positive/unknown amounts, foreign card statements, unknown
extra merchant wording, substrings, reference-field mentions and truncated names do not supply local evidence.
Explicit processor separators are stripped; a bare processor is never a merchant. A town match wins over a
name-only match; equally strong conflicting matches abstain. Only this payment's location counts.

## Evaluation limits

The left-out variant removes **every occurrence of an entire name** if any occurrence is in one of the eight
source circles, within a 250 m safety margin, has a way bounding box touching a circle, or lacks resolved geometry.
This is stricter than dropping just the local row: names from excluded towns cannot train name-only evidence.
The same circles are imported from `eval/sorting/sources.ts`, without opening evaluation payments or labels.

The 500-place known sample is hash-selected from eligible source IDs outside these areas before rendering or
scoring. It uses brief 79's actual renderer/readers and retains truncations, bank layouts and explicit processor
prefixes. Generic marketplaces and delivery wrappers are not used, because their visible purpose can legitimately
differ from the hidden OSM category. PayPal export and bank rows are scored in separate fresh-person calls, as in
the existing scorer. There are no judges for this sample: it measures agreement with the list's own OSM kind,
not independent accuracy or population spending coverage. OSM can be stale, incomplete or mistagged; names can
coincide with unlisted businesses or ordinary prose. Zero observed new errors does not prove zero risk.

The normal benchmark is scored only with the left-out variant. Held-back input remains unopened; tools emit
aggregate counts, never held-back examples or failure details. Experimental scores cannot use `--record` to
enter the default baseline history. The original corpus and labels are never regenerated.
The separate false-match measurement also scores the full list on brands, made-up shops, non-shop payments and
scenarios only; full-list outcomes on OSM benchmark cases are never reported as evidence.

Node timing uses fresh VM contexts, alternating order and 20 measured runs after two warmups. It separately
reports Script construction with distinct filenames, JSON parsing and the first 500-payment sort. A separate
compressed-input run includes gzip inflation and UTF-8 decoding. It excludes file I/O and host bridge costs.
The code-size/startup baseline is pinned to commit `400754e5e0ad17557042a0c39725f909a0fb12dd`, so committing this
experiment does not silently move the baseline. The evaluator also checks default-output parity against it.
For a standalone simulator JavaScriptCore measurement, after `npm run eval:local-places`:

```sh
xcrun --sdk iphonesimulator swiftc scripts/local-places-timing.swift \
  -target arm64-apple-ios27.0-simulator -o .cache/local-places/simulator-timing
# Use absolute paths for all four arguments; simulator working directories differ from the host.
xcrun simctl spawn booted "$PWD/.cache/local-places/simulator-timing" \
  "$PWD/.cache/local-places/baseline-engine.js" "$PWD/.cache/local-places/optional-engine.js" \
  "$PWD/data/local-places/de.json.gz" > data/local-places/simulator.json
# Repeat with de.json and save simulator-json.json for the uncompressed comparison.
```

This creates fresh `JSContext`s and includes engine evaluation, gzip inflation where applicable, UTF-8 decoding,
the data string bridge and JSON.parse. Results bind themselves to the code/data SHA-256 values.
It reads no app store and changes no app files. It is **not** PhoneEngineTests or a complete app launch measurement;
those require the app host to accept an optional list, which is outside this brief.

Claude must run the counts-only private comparison, with the export outside all repositories:

```sh
npx tsx eval/sorting/own-data.ts /outside/all/repos/Aresium-export.json
npx tsx eval/sorting/own-data.ts /outside/all/repos/Aresium-export.json --local-places data/local-places/de.json.gz
npx tsx eval/sorting/own-data.ts /outside/all/repos/Aresium-export.json --local-places data/local-places/de.places.bin.gz
```

The last two counts-only outputs must be identical, including the chronological learning replay.
The scorer also accepts `.places.bin` and `.places.bin.gz`; never use the full list to claim OSM benchmark accuracy.

The operator tool supports export schemas 1–6, ignores stored learned rules and still emits counts only.
No private export has been requested, searched for or opened for this experiment.

## Licence and redistribution

**© OpenStreetMap contributors, ODbL.** This derived database is available under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Source: [Geofabrik Germany extract](https://download.geofabrik.de/europe/germany.html), from
[OpenStreetMap](https://www.openstreetmap.org/copyright).
Both JSON and packed files carry this attribution, source, licence link and the source replication timestamp themselves.
The NSI exclusion vocabulary is not redistributed in these databases; its pinned provenance is recorded in the
build manifest. Existing shop-list NSI licence notices remain in `shops.de.json`.

If Claude adopts a list in the app, its Fonts & licences page needs “© OpenStreetMap contributors, ODbL”, links
to OpenStreetMap's copyright page and ODbL 1.0, and a way to obtain the distributed derived database under ODbL.
Keep the date, build provenance and attribution with downloadable data; review the ODbL distribution obligations
before release. This brief changes no app notice or app behaviour.

## Packed format, version 1 (brief 97)

All integers are unsigned little endian. Every section starts at a multiple of four bytes; intervening padding
is zero. All offsets in the header are absolute byte offsets within this file. String offsets are relative to
their own UTF-8 blob, with one sentinel end offset. Strings have no NUL terminators or BOM. Names are sorted by
unsigned UTF-8 bytes (not locale or UTF-16 order); queries use exactly that ordering. The builder may reorder
rows for this purpose, without changing a name, category, or town pair. Town and category codes preserve their
JSON dictionary positions. Empty town strings are retained. All town pairs are kept, including those for names
with a national category: town evidence can override that category or reveal a collision.

The header is 128 bytes, represented as 32 `Uint32` words:

| Word | Meaning |
|---|---|
| 0 | Magic `0x504c5241` (ASCII `ARLP`) |
| 1 | Packed format version, `1` |
| 2 | Endian marker `0x01020304` |
| 3 | Complete file size in bytes |
| 4–7 | Name count N, town count T, category count C, town-pair count M |
| 8 | Header size, `128` |
| 9–20 | Section offsets in the order below |
| 21 | End offset, equal to file size |
| 22 | FNV-1a checksum of the whole file, treating this word's four bytes as zero |
| 23–31 | Reserved, zero |

| Header word | Section | Representation |
|---|---|---|
| 9 | Name offsets | `Uint32[N + 1]` |
| 10 | Normalised names | UTF-8 bytes |
| 11 | National category per name | `Uint16[N]`; `65535` represents JSON `-1` |
| 12 | Town-pair offsets per name | `Uint32[N + 1]`, indices into the following columns |
| 13 | Town code per pair | `Uint32[M]` |
| 14 | Category code per pair | `Uint16[M]` |
| 15 | Town string offsets | `Uint32[T + 1]` |
| 16 | Town names | UTF-8 bytes |
| 17 | Category string offsets | `Uint32[C + 1]` |
| 18 | Category ids | UTF-8 bytes |
| 19 | Metadata string offsets | `Uint32[4]` |
| 20 | Metadata | UTF-8 data date, attribution, source (including licence links), in that order |

Pairs are grouped by name, then sorted by town code and category code. Category count must be less than 65535.
The sentinel offsets give every blob's exact unpadded byte length. Canonical aligned sections must fill the file
exactly. Validation checks the header/version/host endianness, checksum, bounds, offsets, UTF-8, sorted unique names,
pair ordering and category/town references. The checksum detects accidental corruption; it is not authentication.
A failed load throws `Invalid packed local places: ...`; a failed installation retains the previous index.
Big-endian hosts and unaligned byte slices are refused rather than copied. The app's arm64 host is little endian.
The caller must keep the block immutable and must not detach or resize it after validation.

Only query names are encoded, and only candidate town/category strings are decoded. The reader does not need
`TextEncoder`, `TextDecoder`, `Buffer`, or a Node built-in. No table-wide decoded cache is constructed, even after
lookups. `npm test` checks all columns in both committed compressed assets, deterministic packing, corruption,
Unicode ordering, safeguards and host-style loading in separate bundled VM contexts without browser codecs.
`npm run check:local-places-packed` additionally compares the entire `findLocalPlace` result for every name and
every town pair, using merchant suffix, description and card location fields, against the JSON path. It is a
separate script because it takes minutes. It emits counts only and never changes the database.

## Native host contract for the next app brief

1. Inflate `de.places.bin.gz` natively into one stable allocation, retaining the final raw bytes without making a
   JSON/base64/string/number-array representation. The engine does not inflate gzip. The bytes and an optional
   byte-slice offset must be aligned to four bytes.
2. In the engine's JavaScriptCore context, create an actual JavaScript `ArrayBuffer` over that allocation with
   [JSObjectMakeArrayBufferWithBytesNoCopy](https://developer.apple.com/documentation/javascriptcore/jsobjectmakearraybufferwithbytesnocopy(_:_:_:_:_:_:)).
   Supply the raw pointer, exact raw byte count, an owner/context pointer and a deallocator that releases that
   owner exactly once when JSC releases the backing store. Ownership must survive the call: a pointer obtained
   only for a temporary native buffer access is insufficient. Check both the returned object and exception.
   Apple's API invokes the deallocator on an exception too; the failure path must not free that allocation twice.
3. Protect the returned JS object (`JSValueProtect`, or an appropriately retained host `JSValue`) while installing
   it. Pass it as the actual function argument through the JSC call API to
   `AresiumEngine.setLocalPlaces(arrayBuffer)`, on the context's existing serial worker. Do not stringify that
   argument or put it into the payment-options JSON. After a successful call, the engine's views retain its
   backing store; drop any temporary native/JavaScript globals and release the temporary protection.
4. Subsequent ordinary payment calls use `AresiumEngine.sortPayments(payments, {categories, learned, localPlaces: true})`.
   Only the boolean crosses the payment bridge. Missing/false `localPlaces` leaves the feature off. `true` without
   an installed list behaves like no list. Separate engine contexts have separate installed lists.
5. To unload, call `AresiumEngine.setLocalPlaces(null)`, release any host `JSValue`/global references to the buffer
   or index, then allow JSC to collect it and invoke its deallocator. Replacing the installed list similarly
   releases the previous one when no caller retains it. Do not free the native bytes while any JSC view is live.

No app code was changed here. The host must remeasure the app's loaded and released process-footprint gates;
Node heap/ArrayBuffer counters do not establish simulator or physical-device footprint. Results and exact
reproduction commands for this format are in [PACKED-REPORT.md](PACKED-REPORT.md).
