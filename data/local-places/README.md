# Optional German local places experiment (brief 86)

Off by default. Neither generated list is imported into the engine bundle or enabled in the app.
`de.json` is the full experimental list; `left-out.json` is its evaluation variant. The builder also produces
deterministic `.json.gz` files. The candidate app asset is `de.json.gz`, inflated in memory by a native host before
JSON parsing; the engine receives the resulting JSON object and contains no decompressor or Node dependency.
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

The engine accepts `sortPayments(payments, { categories, learned, localPlaces })`, using a JSON-parsed list.
It reads the sorted table by binary search, with no index construction or global mutable cache.
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
npx tsx eval/sorting/own-data.ts /outside/all/repos/Aresium-export.json --local-places data/local-places/de.json
```

The operator tool supports export schemas 1–6, ignores stored learned rules and still emits counts only.
No private export has been requested, searched for or opened for this experiment.

## Licence and redistribution

**© OpenStreetMap contributors, ODbL.** This derived database is available under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Source: [Geofabrik Germany extract](https://download.geofabrik.de/europe/germany.html), from
[OpenStreetMap](https://www.openstreetmap.org/copyright).
The JSON files carry this attribution, source, licence link and the source replication timestamp themselves.
The NSI exclusion vocabulary is not redistributed in these databases; its pinned provenance is recorded in the
build manifest. Existing shop-list NSI licence notices remain in `shops.de.json`.

If Claude adopts a list in the app, its Fonts & licences page needs “© OpenStreetMap contributors, ODbL”, links
to OpenStreetMap's copyright page and ODbL 1.0, and a way to obtain the distributed derived database under ODbL.
Keep the date, build provenance and attribution with downloadable data; review the ODbL distribution obligations
before release. This brief changes no app notice or app behaviour.
