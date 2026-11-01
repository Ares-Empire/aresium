// Development only. Two streaming passes: named POIs, then coordinates of their way nodes. No engine dependency.
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { Duplex } from "node:stream";
import { pathToFileURL } from "node:url";
import { packLocalPlaces } from "./local-places-pack.js";
import type { LocalPlacesData } from "../src/engine/sorting/local-places.js";
import { gzipSync, gunzipSync } from "node:zlib";
import parsePbf, { type Element } from "osm-pbf-parser";
import shops from "../src/engine/sorting/shops.de.json" with { type: "json" };
import { NSI } from "./build-shop-list.js";
import { localName } from "../src/engine/sorting/local-places.js";
import { buildLocalPlaces, intersectsExcludedArea, placeFact, type PlaceFact } from "./local-places-build.js";
import { shopSpellings } from "../src/engine/sorting/shop-words.js";

export const CACHE = new URL("../.cache/local-places/", import.meta.url);
export const DATA = new URL("../data/local-places/", import.meta.url);
const PBF_URL = "https://download.geofabrik.de/europe/germany-latest.osm.pbf";
const pbf = new URL("germany.osm.pbf", CACHE);
type Extract = { dataDate: string; sha256: string; bytes: number; facts: PlaceFact[]; stats: Record<string, number> };
async function download(): Promise<void> {
  console.log(`Downloading ${PBF_URL} (about 5 GB; cached for later rebuilds)`);
  const response = await fetch(PBF_URL);
  if (!response.ok || !response.body) throw new Error(`Extract download: HTTP ${response.status}`);
  const temporary = new URL("germany.osm.pbf.part", CACHE);
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(temporary));
  if (response.headers.get("content-length") && (await stat(temporary)).size !== Number(response.headers.get("content-length"))) throw new Error("Truncated extract");
  await rename(temporary, pbf);
}
async function scan(visit: (element: Element) => void, nodesOnly = false): Promise<void> {
  const input = createReadStream(pbf), parser = parsePbf();
  let count = 0, next = 10_000_000;
  try {
    // The parser uses readable-stream v2, which predates async iteration. Its data callbacks are synchronous.
    await new Promise<void>((resolve, reject) => {
      input.on("error", reject); parser.on("error", reject); parser.on("end", resolve);
      parser.on("data", (items: Element[]) => {
        try {
          if (nodesOnly && items[0]?.type !== "node") { input.destroy(); parser.destroy(); resolve(); return; }
          for (const item of items) visit(item);
          count += items.length;
          if (count >= next) { console.log(`Scanned ${Math.floor(count / 1_000_000)} million elements`); next += 10_000_000; }
        } catch (error) { input.destroy(); parser.destroy(); reject(error); }
      });
      input.pipe(parser);
    });
  } finally { input.destroy(); parser.destroy(); }
}
async function extract(): Promise<Extract> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(pbf)) digest.update(chunk);
  // The extract's replication timestamp, not today's clock, is its data date.
  // HeaderBlock is decoded by the parser; read its public header pipeline once to get the timestamp.
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const parserTypes = require("osm-pbf-parser") as { BlobParser: new () => Duplex; BlobDecompressor: new () => Duplex };
  const schemas = require("osm-pbf-parser/lib/parsers.js") as { osm: { HeaderBlock: { decode(data: Buffer): { osmosis_replication_timestamp?: number } } } };
  const headerInput = createReadStream(pbf);
  const blobs = new parserTypes.BlobParser(), decompressor = new parserTypes.BlobDecompressor();
  let dataDate = "";
  try {
    const blob = await new Promise<{ type: string; data: Buffer }>((resolve, reject) => {
      headerInput.on("error", reject); blobs.on("error", reject); decompressor.on("error", reject);
      decompressor.once("data", resolve); decompressor.on("end", () => reject(new Error("Missing PBF header")));
      headerInput.pipe(blobs).pipe(decompressor);
    });
    if (blob.type !== "OSMHeader") throw new Error("Missing PBF header");
    const timestamp = schemas.osm.HeaderBlock.decode(blob.data).osmosis_replication_timestamp;
    if (!timestamp) throw new Error("Missing extract replication date");
    dataDate = new Date(Number(timestamp) * 1000).toISOString();
  } finally { headerInput.destroy(); blobs.destroy(); decompressor.destroy(); }
  const facts: PlaceFact[] = [], ways: { fact: PlaceFact; refs: number[] }[] = [];
  const stats = { nodes: 0, ways: 0, relations: 0, missingWayGeometry: 0 };
  console.log("Pass 1: named places and their classifications");
  await scan((element) => {
    const tags = element.tags;
    if (!(tags?.name || tags?.["name:de"]) || !["shop", "amenity", "healthcare", "tourism", "leisure", "office"].some((key) => tags[key])) return;
    const fact = placeFact(`${element.type}/${element.id}`, tags, element.lat, element.lon);
    facts.push(fact); stats[`${element.type}s` as "nodes" | "ways" | "relations"]++;
    if (element.type === "way") ways.push({ fact, refs: element.refs ?? [] });
  });
  const needed = new Set(ways.flatMap((way) => way.refs));
  const points = new Map<number, [number, number]>();
  console.log(`Pass 2: coordinates for ${needed.size} way nodes`);
  await scan((element) => {
    if (element.type === "node" && needed.has(element.id) && element.lat !== undefined && element.lon !== undefined) points.set(element.id, [element.lat, element.lon]);
  }, true);
  for (const { fact, refs } of ways) {
    const coordinates = refs.map((ref) => points.get(ref)).filter((p): p is [number, number] => !!p);
    if (coordinates.length !== refs.length || !coordinates.length) { stats.missingWayGeometry++; continue; }
    fact.lat = coordinates.reduce((n, p) => n + p[0], 0) / coordinates.length;
    fact.lon = coordinates.reduce((n, p) => n + p[1], 0) / coordinates.length;
    fact.excluded = intersectsExcludedArea(coordinates);
  }
  // Relations have no safely resolved geometry: their names are removed entirely from the left-out variant.
  return { dataDate, sha256: digest.digest("hex"), bytes: (await stat(pbf)).size, facts, stats };
}
export async function knownNames(): Promise<Set<string>> {
  const file = new URL(`nsi-${NSI.version}.json`, CACHE);
  let text: string;
  try { text = await readFile(file, "utf8"); } catch {
    const response = await fetch(NSI.url);
    if (!response.ok) throw new Error(`NSI download: HTTP ${response.status}`);
    text = await response.text();
    if (createHash("sha256").update(text).digest("hex") !== NSI.sha256) throw new Error("NSI checksum mismatch");
    await writeFile(file, text);
  }
  if (createHash("sha256").update(text).digest("hex") !== NSI.sha256) throw new Error("Cached NSI checksum mismatch");
  const nsi = JSON.parse(text) as { nsi: Record<string, { items: { displayName: string; tags: Record<string, string>; matchNames?: string[] }[] }> };
  // All NSI names worldwide, including brands excluded from the engine list and spelling aliases.
  return new Set([...shops.rules, ...shops.merchants, ...shops.brands].flatMap(([, names]) => names)
    .concat(Object.values(nsi.nsi).flatMap((section) => section.items.flatMap((item) => [item.displayName, ...item.matchNames ?? [],
      ...["name", "name:de", "brand", "brand:de", "operator", "network"].map((key) => item.tags[key]).filter(Boolean)]))).flatMap((name) => shopSpellings(name)).map(localName));
}
async function writePacked(variant: string, data: LocalPlacesData): Promise<void> {
  const packed = packLocalPlaces(data);
  const gzip = gzipSync(packed, { level: 9 });
  await writeFile(new URL(`${variant}.places.bin`, DATA), packed);
  await writeFile(new URL(`${variant}.places.bin.gz`, DATA), gzip);
  console.log(`${variant}: ${packed.length} packed bytes, ${gzip.length} gzip bytes`);
}
export async function build(args = process.argv.slice(2)): Promise<void> {
  if (args.some((arg) => !["--fresh", "--pack-only"].includes(arg)) || args.length > 1) throw new Error("Use npm run local-places [-- --fresh | --pack-only]");
  if (args.includes("--pack-only")) {
    for (const variant of ["de", "left-out"]) {
      const bytes = gunzipSync(await readFile(new URL(`${variant}.json.gz`, DATA)));
      const data = JSON.parse(bytes.toString("utf8")) as LocalPlacesData;
      await writeFile(new URL(`${variant}.json`, DATA), bytes);
      await writePacked(variant, data);
    }
    return;
  }
  await mkdir(CACHE, { recursive: true }); await mkdir(DATA, { recursive: true });
  const cache = new URL("places-v1.json", CACHE);
  let extracted: Extract | undefined;
  if (!args.includes("--fresh")) try { extracted = JSON.parse(await readFile(cache, "utf8")) as Extract; } catch { /* first build */ }
  if (!extracted) {
    if (args.includes("--fresh") || !await stat(pbf).catch(() => null)) await download();
    extracted = await extract();
    await writeFile(cache, JSON.stringify(extracted));
  }
  const names = await knownNames();
  const reports: Record<string, unknown> = {};
  for (const [variant, leftOut] of [["de", false], ["left-out", true]] as const) {
    const result = buildLocalPlaces(extracted.facts, names, extracted.dataDate, leftOut);
    const text = JSON.stringify(result.data) + "\n";
    await writeFile(new URL(`${variant}.json`, DATA), text);
    await writeFile(new URL(`${variant}.json.gz`, DATA), gzipSync(text, { level: 9 }));
    await writePacked(variant, result.data);
    reports[variant] = result.stats;
    // Public source facts for fresh known-place sampling remain ignored, never imported into the engine.
    if (!leftOut) await writeFile(new URL("eligible-sample.json", CACHE), JSON.stringify(result.places.filter((p) => !p.excluded)));
  }
  await writeFile(new URL("build.json", DATA), JSON.stringify({ source: PBF_URL, dataDate: extracted.dataDate,
    pbfSha256: extracted.sha256, pbfBytes: extracted.bytes, parser: "osm-pbf-parser@2.3.0", nsi: NSI.sha256,
    extract: extracted.stats, variants: reports }, null, 2) + "\n");
  console.log(JSON.stringify(reports, null, 2));
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await build();
