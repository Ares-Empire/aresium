// Aggregate experiment only. Held-back rows never appear in this tool's output or saved report.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createContext, Script } from "node:vm";
import { performance } from "node:perf_hooks";
import { gzipSync, gunzipSync, brotliCompressSync } from "node:zlib";
import { createHash } from "node:crypto";
import { bundleEngine } from "./build-engine.js";
import { CACHE, DATA } from "./build-local-places.js";
import type { PlaceFact } from "./local-places-build.js";
import { DEFAULT_CATEGORIES } from "../src/engine/categories.js";
import { sortPayments } from "../src/engine/sorting/sort.js";
import { findLocalPlace, indexLocalPlaces, type LocalPlacesData } from "../src/engine/sorting/local-places.js";
import { count, loadLabels, predict, type Sorter } from "../eval/sorting/score.js";
import { heldback, loadCases, type Label, type EvalCase } from "../eval/sorting/model.js";
import { render } from "../eval/sorting/render.js";

// The round-1 baseline stays fixed after Claude commits this experiment and HEAD moves.
const JSON_COMPARISON_COMMIT = "641c773951284ef392d975ed2ab114ee43036719";
const BASELINE_COMMIT = "400754e5e0ad17557042a0c39725f909a0fb12dd";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const bytes = (text: string) => ({ raw: Buffer.byteLength(text), gzip: gzipSync(text, { level: 9 }).length, brotli: brotliCompressSync(text).length });
function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], minMs: sorted[0], maxMs: sorted.at(-1) };
}
export async function measure(): Promise<void> {
  await mkdir(DATA, { recursive: true });
  const fullText = await readFile(new URL("de.json", DATA), "utf8");
  const full = JSON.parse(fullText) as LocalPlacesData;
  const compressedData = await readFile(new URL("de.json.gz", DATA));
  if (gunzipSync(compressedData).toString("utf8") !== fullText) throw new Error("Compressed data does not match JSON");
  const leftOut = JSON.parse(await readFile(new URL("left-out.json", DATA), "utf8")) as LocalPlacesData;
  const fullPacked = indexLocalPlaces(gunzipSync(await readFile(new URL("de.places.bin.gz", DATA))));
  const leftPacked = indexLocalPlaces(gunzipSync(await readFile(new URL("left-out.places.bin.gz", DATA))));
  const parity = (json: Map<string, string | null>, packed: Map<string, string | null>) => {
    const changed = [...json].filter(([id, value]) => packed.get(id) !== value).length;
    if (changed) throw new Error(`Packed predictions differ: ${changed} (details withheld)`);
    return changed;
  };
  const baseline: Sorter = sortPayments;
  const optional: Sorter = (payments, options) => sortPayments(payments, { ...options, localPlaces: leftOut });
  const cases = await loadCases();
  const { labels, judged } = await loadLabels(cases);
  const before = predict(cases, baseline), after = predict(cases, optional);
  const leftOutChanges = parity(after, predict(cases, (payments, options) => sortPayments(payments, { ...options, localPlaces: leftPacked })));
  const score = (rows: EvalCase[], predictions: Map<string, string | null>) => count(rows.map((c) => ({ label: labels.get(c.id)!, category: predictions.get(c.id)! })));
  const benchmark: Record<string, unknown> = {};
  for (const [name, rows] of [["worked", cases.filter((c) => !heldback(c.id))], ["heldback", cases.filter((c) => heldback(c.id))]] as const) {
    const byKind = Object.fromEntries(["osm", "brand", "madeup", "nonshop", "scenario"].map((kind) => {
      const subset = rows.filter((c) => c.kind === kind);
      return [kind, { before: score(subset, before), after: score(subset, after) }];
    }));
    benchmark[name] = { before: score(rows, before), after: score(rows, after), byKind,
      changed: rows.filter((c) => before.get(c.id) !== after.get(c.id)).length,
      newWrong: rows.filter((c) => !labels.get(c.id)!.disputed && after.get(c.id) !== null
        && !labels.get(c.id)!.accepted.includes(after.get(c.id)!) && before.get(c.id) !== after.get(c.id)).length };
  }
  // Only non-OSM outcomes are scored with the full database. OSM benchmark outcomes still count ONLY left-out.
  const fullPredictions = predict(cases, (payments, options) => sortPayments(payments, { ...options, localPlaces: full }));
  const fullChanges = parity(fullPredictions, predict(cases, (payments, options) => sortPayments(payments, { ...options, localPlaces: fullPacked })));
  const elsewhere = Object.fromEntries([false, true].map((held) => [held ? "heldback" : "worked",
    Object.fromEntries(["brand", "madeup", "nonshop", "scenario"].map((kind) => {
      const rows = cases.filter((c) => heldback(c.id) === held && c.kind === kind);
      return [kind, { before: score(rows, before), leftOut: score(rows, after), full: score(rows, fullPredictions),
        newWrongWithFull: rows.filter((c) => !labels.get(c.id)!.disputed && fullPredictions.get(c.id) !== null
          && !labels.get(c.id)!.accepted.includes(fullPredictions.get(c.id)!) && before.get(c.id) !== fullPredictions.get(c.id)).length }];
    }))]));
  // Fixed fresh seed, hash order of SOURCE ids, selected before rendering or looking at engine results.
  // No judges: this is agreement with OSM kinds of places already present in the full list.
  const pool = JSON.parse(await readFile(new URL("eligible-sample.json", CACHE), "utf8")) as PlaceFact[];
  const seed = "aresium-86-known-places-2026-11-01-v1";
  const sample = pool.map((p) => ({ p, rank: hash(`${seed}:${p.id}`) })).sort((a, b) => a.rank.localeCompare(b.rank)).slice(0, 500).map(({ p }) => p);
  if (sample.length !== 500) throw new Error("Need 500 eligible source places");
  const rendered: EvalCase[] = [];
  for (const [index, place] of sample.entries()) {
    const result = await render({ name: place.name, town: place.town || place.postcode, amount: -12.34,
      service: ["direct", "SUMUP *", "ZETTLE_", "PAYPAL *"][index % 4], answer: { best: place.category, alsoRight: place.alsoRight } }, index);
    rendered.push({ id: place.id, kind: "osm", ...result, generator: { best: place.category, alsoRight: place.alsoRight }, facts: {} });
  }
  const sampleLabels = new Map(rendered.map((c) => [c.id, { id: c.id, accepted: [c.generator.best!, ...c.generator.alsoRight ?? []],
    unsortedRight: false, disputed: false, fingerprint: "", basis: "generator" } satisfies Label]));
  const sampleBefore = predict(rendered), sampleAfter = predict(rendered, (payments, options) => sortPayments(payments, { ...options, localPlaces: full }));
  const knownChanges = parity(sampleAfter, predict(rendered, (payments, options) => sortPayments(payments, { ...options, localPlaces: fullPacked })));
  const localMatchChanges = rendered.filter((c) => JSON.stringify(findLocalPlace(c.payment, full)) !== JSON.stringify(findLocalPlace(c.payment, fullPacked))).length;
  if (localMatchChanges) throw new Error("Packed local matches differ (details withheld)");
  const knownScore = (predictions: Map<string, string | null>) => count(rendered.map((c) => ({ label: sampleLabels.get(c.id)!, category: predictions.get(c.id)! })));
  const known = { seed, sampleSize: sample.length, pool: pool.length, sourceIdHash: hash(sample.map((p) => p.id).join("\n")),
    method: "Unjudged OSM-kind agreement, not independent accuracy; fresh source places outside all eight exclusion circles; direct/explicit processor renderings; original renderer truncations and bank layouts retained.",
    before: knownScore(sampleBefore), after: knownScore(sampleAfter),
    localMatched: rendered.filter((c) => findLocalPlace(c.payment, full)).length,
    newWrong: rendered.filter((c) => sampleAfter.get(c.id) !== null && !sampleLabels.get(c.id)!.accepted.includes(sampleAfter.get(c.id)!) && sampleBefore.get(c.id) !== sampleAfter.get(c.id)).length,
    examples: rendered.filter((c) => sampleBefore.get(c.id) === null && sampleAfter.get(c.id) !== null
      && sampleLabels.get(c.id)!.accepted.includes(sampleAfter.get(c.id)!)).slice(0, 5).map((c, i) => ({
        anonymisedName: `Local place ${i + 1}`, category: sampleAfter.get(c.id), layout: c.rendering.layout,
        match: findLocalPlace(c.payment, full)?.town ? "name and town" : "name alone" })),
    byCategory: Object.fromEntries([...new Set(rendered.map((c) => c.generator.best!))].sort().map((category) => {
      const rows = rendered.filter((c) => c.generator.best === category);
      return [category, { before: count(rows.map((c) => ({ label: sampleLabels.get(c.id)!, category: sampleBefore.get(c.id)! }))),
        after: count(rows.map((c) => ({ label: sampleLabels.get(c.id)!, category: sampleAfter.get(c.id)! }))) }];
    })),
    byLayout: Object.fromEntries([...new Set(rendered.map((c) => c.rendering.layout))].sort().map((layout) => {
      const rows = rendered.filter((c) => c.rendering.layout === layout);
      return [layout, { before: count(rows.map((c) => ({ label: sampleLabels.get(c.id)!, category: sampleBefore.get(c.id)! }))),
        after: count(rows.map((c) => ({ label: sampleLabels.get(c.id)!, category: sampleAfter.get(c.id)! }))) }];
    })) };

  const overrides = new Map(["src/engine/index.ts", "src/engine/sorting/sort.ts"].map((path) => [fileURLToPath(new URL(`../${path}`, import.meta.url)),
    execFileSync("git", ["show", `${BASELINE_COMMIT}:${path}`], { encoding: "utf8" })]));
  const [oldBundle, bundle] = await Promise.all([bundleEngine(overrides), bundleEngine()]);
  await writeFile(new URL("baseline-engine.js", CACHE), oldBundle);
  await writeFile(new URL("optional-engine.js", CACHE), bundle);
  const oldContext = createContext({}); new Script(oldBundle).runInContext(oldContext);
  const oldPredictions = predict(cases, (oldContext.AresiumEngine as { sortPayments: Sorter }).sortPayments);
  const defaultParityChanges = cases.filter((c) => before.get(c.id) !== oldPredictions.get(c.id)).length;
  if (defaultParityChanges) throw new Error("The default engine changed results without a local list");
  // Confirm the JSON matcher/sorter from this checkout before brief 97, independently of the refactor.
  const checkoutOverrides = new Map(["src/engine/index.ts", "src/engine/sorting/sort.ts", "src/engine/sorting/local-places.ts"].map((path) =>
    [fileURLToPath(new URL(`../${path}`, import.meta.url)), execFileSync("git", ["show", `${JSON_COMPARISON_COMMIT}:${path}`], { encoding: "utf8" })]));
  const checkoutContext = createContext({});
  new Script(await bundleEngine(checkoutOverrides)).runInContext(checkoutContext);
  const checkoutSorter = (checkoutContext.AresiumEngine as { sortPayments: Sorter }).sortPayments;
  const checkoutJsonChanges = {
    leftOut: parity(after, predict(cases, (payments, options) => checkoutSorter(payments, { ...options, localPlaces: leftOut }))),
    full: parity(fullPredictions, predict(cases, (payments, options) => checkoutSorter(payments, { ...options, localPlaces: full }))),
    known: parity(sampleAfter, predict(rendered, (payments, options) => checkoutSorter(payments, { ...options, localPlaces: full }))),
  };
  const scripts = [new Script(oldBundle), new Script(bundle)];
  const load = new Script("globalThis.localPlaces = JSON.parse(localPlacesJSON)");
  const firstSort = new Script("AresiumEngine.sortPayments(payments, {categories, localPlaces})");
  const start: number[][] = [[], []], parsing: number[] = [], first: number[][] = [[], []];
  // Alternate order; fresh VM contexts; code compilation excluded, reported separately below.
  for (let trial = 0; trial < 22; trial++) for (const variant of trial % 2 ? [1, 0] : [0, 1]) {
    const context = createContext({ localPlacesJSON: fullText, categories: DEFAULT_CATEGORIES, payments: rendered.map((c) => c.payment) });
    const t0 = performance.now(); scripts[variant].runInContext(context);
    const t1 = performance.now();
    if (variant) load.runInContext(context); else context.localPlaces = undefined;
    const t2 = performance.now();
    firstSort.runInContext(context); const t3 = performance.now();
    if (trial >= 2) { start[variant].push(t2 - t0); first[variant].push(t3 - t2); if (variant) parsing.push(t2 - t1); }
  }
  const compile: number[][] = [[], []];
  for (let trial = 0; trial < 20; trial++) for (const [i, code] of [oldBundle, bundle].entries()) {
    // Distinct origins prevent V8's same-source Script cache from masquerading as cold compilation.
    const start = performance.now(); new Script(code, { filename: `local-places-${i}-${trial}.js` }); compile[i].push(performance.now() - start);
  }
  const decompress: number[] = [], compressedStart: number[] = [];
  for (let trial = 0; trial < 22; trial++) {
    const context = createContext({});
    const t0 = performance.now(); scripts[1].runInContext(context);
    const t1 = performance.now(); context.localPlacesJSON = gunzipSync(compressedData).toString("utf8");
    const t2 = performance.now(); load.runInContext(context); const t3 = performance.now();
    if (trial >= 2) { decompress.push(t2 - t1); compressedStart.push(t3 - t0); }
  }
  const timing = { runtime: process.version, platform: `${process.platform}/${process.arch}`, samples: 20, warmups: 2,
    method: "Fresh Node vm contexts; alternating baseline and optional bundle; separate JSON.parse for supplied data; no file I/O or JSON bridge serialization; first sort is 500 rendered payments; code compiled separately.",
    baselineStartup: summary(start[0]), optionalStartupWithData: summary(start[1]), dataParse: summary(parsing),
    addedStartupMedianMs: summary(start[1]).medianMs - summary(start[0]).medianMs,
    addedStartupPaired: summary(start[1].map((value, i) => value - start[0][i])),
    gzipDecode: summary(decompress), optionalStartupWithGzip: summary(compressedStart),
    addedGzipStartupMedianMs: summary(compressedStart).medianMs - summary(start[0]).medianMs,
    baselineFirstSort500: summary(first[0]), optionalFirstSort500: summary(first[1]),
    baselineCompile: summary(compile[0]), optionalCompile: summary(compile[1]),
    simulator: "Not measured through PhoneEngineTests: the app host has no optional-list input; app changes are outside this brief. See simulator.json if the separate standalone simulator harness was run. Node timings alone do not establish the 200 ms simulator budget." };
  const oldSize = bytes(oldBundle), size = bytes(bundle);
  const report = { dataDate: full.dataDate, baselineCommit: BASELINE_COMMIT, judged, defaultParityChanges, build: JSON.parse(await readFile(new URL("build.json", DATA), "utf8")),
    packedParity: { jsonComparisonCommit: JSON_COMPARISON_COMMIT, leftOutChanges, fullChanges, knownChanges, localMatchChanges, checkoutJsonChanges },
    sizes: { baselineBundle: oldSize, optionalCodeBundle: size,
      codeAdded: { raw: size.raw - oldSize.raw, gzip: size.gzip - oldSize.gzip, brotli: size.brotli - oldSize.brotli },
      fullData: bytes(fullText), leftOutData: bytes(await readFile(new URL("left-out.json", DATA), "utf8")),
      dataBundledByDefault: false }, timing, benchmark, elsewhere, known };
  await writeFile(new URL(process.argv.includes("--packed") ? "packed-evaluation.json" : "measurements.json", DATA), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await measure();
