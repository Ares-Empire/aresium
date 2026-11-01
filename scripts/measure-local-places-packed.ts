// Fresh Node processes, fictional payments using public-list merchant names; aggregate output only.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { cpus, totalmem } from "node:os";
import { findLocalPlace, indexLocalPlaces, setLocalPlaces, type LocalPlacesData, type LocalPlacesIndex } from "../src/engine/sorting/local-places.js";
import { DEFAULT_CATEGORIES, sortPayments } from "../src/engine/index.js";
import type { SortingPayment } from "../src/engine/sorting/merchant.js";

const DATA = new URL("../data/local-places/", import.meta.url);
const fields = ["heapUsed", "arrayBuffers", "external", "rss"] as const;
type Memory = Pick<NodeJS.MemoryUsage, typeof fields[number]>;
const memory = (): Memory => { const m = process.memoryUsage(); return Object.fromEntries(fields.map((key) => [key, m[key]])) as Memory; };
const delta = (a: Memory, b: Memory): Memory => Object.fromEntries(fields.map((key) => [key, a[key] - b[key]])) as Memory;
const collect = () => { for (let i = 0; i < 3; i++) global.gc!(); };
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summariseMemory = (values: Memory[]) => Object.fromEntries(fields.map((key) => [key, median(values.map((m) => m[key]))]));

function worker(format: string) {
  if (!global.gc) throw new Error("Run Node with --expose-gc");
  const sample = JSON.parse(readFileSync(0, "utf8")) as SortingPayment[];
  collect(); const before = memory();
  let readMs = 0, indexMs = 0;
  const load = (): LocalPlacesIndex => {
    const start = performance.now();
    if (format === "json") {
      const text = readFileSync(new URL("de.json", DATA), "utf8");
      const read = performance.now(), result = JSON.parse(text) as LocalPlacesData;
      readMs = read - start; indexMs = performance.now() - read;
      return result;
    }
    const bytes = readFileSync(new URL("de.places.bin", DATA));
    const read = performance.now(), result = indexLocalPlaces(bytes);
    readMs = read - start; indexMs = performance.now() - read;
    return result;
  };
  let list: LocalPlacesIndex | null = load();
  collect(); const loaded = memory();
  setLocalPlaces(list);
  const lookup: number[] = [], sorting: Record<string, number[]> = { "1250": [], "5000": [] };
  let matches = 0;
  // Two warmups, ten timed samples. The same 500 payments in each independent process.
  for (let trial = 0; trial < 12; trial++) {
    const start = performance.now();
    for (const pay of sample) matches += Number(findLocalPlace(pay, list) !== null);
    if (trial >= 2) lookup.push((performance.now() - start) * 1000 / sample.length);
  }
  for (const size of [1250, 5000]) {
    const payments = Array.from({ length: size }, (_, i) => sample[i % sample.length]);
    for (let trial = 0; trial < 12; trial++) {
      const start = performance.now(); sortPayments(payments, { categories: DEFAULT_CATEGORIES, localPlaces: true });
      if (trial >= 2) sorting[size].push((performance.now() - start) * 1000 / size);
    }
  }
  collect(); const afterLookups = memory();
  setLocalPlaces(null); list = null;
  collect(); const released = memory();
  return { format, readMs, indexMs, loadMs: readMs + indexMs, before, loaded, loadedDelta: delta(loaded, before),
    afterLookups, afterLookupsDelta: delta(afterLookups, before), released, releasedDelta: delta(released, before),
    lookupUsPerPayment: median(lookup), sortUsPerPayment: Object.fromEntries(Object.entries(sorting).map(([size, values]) => [size, median(values)])), matches };
}

if (process.argv[2] === "--worker") {
  console.log(JSON.stringify(worker(process.argv[3])));
} else {
  const jsonBytes = gunzipSync(readFileSync(new URL("de.json.gz", DATA)));
  const json = JSON.parse(jsonBytes.toString("utf8")) as LocalPlacesData;
  const sample: SortingPayment[] = Array.from({ length: 500 }, (_, i) => {
    const [name, , towns] = json.rows[Math.floor(i * json.rows.length / 500)];
    const town = towns.length ? json.towns[towns[0]] : "";
    return { counterparty: i % 4 === 0 ? "Unbekannter Quarzfunkenladen" : i % 4 === 1 ? name : `${name} ${town} DE`, amount: -12, source: "bank" };
  });
  const runs: ReturnType<typeof worker>[] = [];
  // Alternate format order. Fresh processes avoid attributing one format's allocator pages to the other.
  for (let trial = 0; trial < 3; trial++) for (const format of trial % 2 ? ["packed", "json"] : ["json", "packed"]) {
    runs.push(JSON.parse(execFileSync(process.execPath, ["--expose-gc", "--import", "tsx", fileURLToPath(import.meta.url), "--worker", format],
      { input: JSON.stringify(sample), encoding: "utf8" })));
  }
  const sizes = Object.fromEntries(["de", "left-out"].map((variant) => {
    const compressed = readFileSync(new URL(`${variant}.places.bin.gz`, DATA)), raw = gunzipSync(compressed);
    return [variant, { raw: raw.length, gzip: compressed.length, sha256: createHash("sha256").update(raw).digest("hex") }];
  }));
  const summary = Object.fromEntries(["json", "packed"].map((format) => {
    const values = runs.filter((run) => run.format === format);
    if (values.some((run) => run.matches !== runs[0].matches)) throw new Error("Measurement workloads disagree");
    return [format, { readMs: median(values.map((v) => v.readMs)), indexMs: median(values.map((v) => v.indexMs)), loadMs: median(values.map((v) => v.loadMs)),
      loadedDelta: summariseMemory(values.map((v) => v.loadedDelta)), afterLookupsDelta: summariseMemory(values.map((v) => v.afterLookupsDelta)),
      releasedDelta: summariseMemory(values.map((v) => v.releasedDelta)), lookupUsPerPayment: median(values.map((v) => v.lookupUsPerPayment)),
      sortUsPerPayment: Object.fromEntries([1250, 5000].map((size) => [size, median(values.map((v) => v.sortUsPerPayment[size]))])) }];
  }));
  const report = { runtime: process.version, platform: `${process.platform}/${process.arch}`, cpu: cpus()[0].model, hostMemoryBytes: totalmem(), dataDate: json.dataDate,
    method: "Three fresh --expose-gc Node processes per format, alternating order. Medians of each process's samples. Baseline includes 500 prepared fictional payments; raw files read from warm filesystem cache. Load separates file read (including UTF-8 for JSON) from JSON.parse or packed validation/indexing. No gzip inflation, native bridge, or engine bundle evaluation in load. Three GCs before each memory snapshot. Lookup and sort: two warmups then ten samples per size. Memory deltas in bytes; external includes arrayBuffers, so do not add both. RSS reflects allocator retention, not live object size. No app/JSC/device memory measurement.",
    sizes, summary, runs };
  const packed = summary.packed.loadedDelta;
  if (packed.arrayBuffers > sizes.de.raw + 300_000 || packed.heapUsed > 300_000) throw new Error("Packed index exceeds buffer plus 300 KB budget");
  writeFileSync(new URL("packed-measurements.json", DATA), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
