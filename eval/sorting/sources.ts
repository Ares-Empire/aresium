import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fromTags } from "./mapping.js";
import { ROOT, hash } from "./model.js";
export const NSI = {
  version: "8.0.20260918", url: "https://cdn.jsdelivr.net/npm/name-suggestion-index@8.0.20260918/dist/json/nsi.min.json",
  sha256: "85752fb28977082f6e631636f1e9b8f97513947f75aaf1338c47ffa87207f513",
};
export const PLACES = [
  { name: "Garching", lat: 48.249, lon: 11.652, radius: 3500, target: 75 },
  { name: "München Schwabing", lat: 48.164, lon: 11.585, radius: 2200, target: 125 },
  { name: "Köln", lat: 50.938, lon: 6.955, radius: 2200, target: 125 },
  { name: "Berlin Kreuzberg", lat: 52.499, lon: 13.423, radius: 1200, target: 125 },
  { name: "Leipzig", lat: 51.340, lon: 12.375, radius: 2500, target: 110 },
  { name: "Hamburg", lat: 53.555, lon: 9.981, radius: 2300, target: 125 },
  { name: "Wernigerode", lat: 51.834, lon: 10.786, radius: 3000, target: 90 },
  { name: "Wacken", lat: 54.020, lon: 9.375, radius: 3500, target: 25 },
] as const;
export type Tags = Record<string, string>;
export type Place = { type: string; id: number; tags: Tags };
export type NsiItem = { displayName: string; tags: Tags; locationSet: { include?: unknown[]; exclude?: unknown[] }; fromTemplate?: boolean };
export type Brand = { name: string; tags: Tags; path: string };
const cache = new URL(".cache/", ROOT);
async function cached(name: string, url: string, body?: string): Promise<string> {
  const path = new URL(name, cache);
  try { return await readFile(path, "utf8"); } catch { /* explicit generation downloads only */ }
  const response = await fetch(body ? `${url}?${body}` : url, { method: "GET",
    headers: { "User-Agent": "AresiumSortingEvaluation/1.0 (https://aresium.de; synthetic public-place evaluation)", ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Source download failed: HTTP ${response.status}`);
  const text = await response.text();
  JSON.parse(text); // Never cache an error/HTML response.
  await mkdir(cache, { recursive: true });
  await writeFile(path, text);
  return text;
}
export async function nsiBrands(): Promise<Brand[]> {
  const text = await cached("nsi.json", NSI.url);
  if (hash(text) !== NSI.sha256) throw new Error("NSI checksum mismatch");
  const data = JSON.parse(text) as { nsi: Record<string, { items: NsiItem[] }> };
  const areas = new Set(["de", "001", "150", "155", "eu", "aldi-sued.geojson", "konsum-dresden.geojson", "konsum-leipzig.geojson", "stadtmobil-suedbaden.geojson"]);
  const brands: Brand[] = [];
  for (const [path, section] of Object.entries(data.nsi)) for (const item of section.items) {
    const include = (item.locationSet.include ?? []).map((s) => String(s).toLowerCase());
    const exclude = (item.locationSet.exclude ?? []).map((s) => String(s).toLowerCase());
    if (item.fromTemplate || exclude.includes("de") || !include.some((s) => areas.has(s) || s.startsWith("de-"))) continue;
    const name = item.tags["name:de"] || item.tags.name || item.tags["brand:de"] || item.tags.brand || item.tags.network || item.tags.operator;
    if (name && /[\p{L}]/u.test(name)) brands.push({ name, tags: cleanTags(item.tags), path });
  }
  return brands.sort((a, b) => a.name.localeCompare(b.name, "de") || a.path.localeCompare(b.path));
}
// Only classification facts survive into the versioned set. Contact/address/operator/person tags never do.
export function cleanTags(tags: Tags): Tags {
  return Object.fromEntries(Object.entries(tags).filter(([key]) => ["shop", "amenity", "healthcare", "leisure", "tourism", "office", "cuisine", "sport"].includes(key)));
}
export { anonymisePersonNames as anonymise } from "./person-names.js";
export async function osmPlaces(): Promise<{ place: typeof PLACES[number]; elements: Place[] }[]> {
  const all = [];
  const missing: string[] = [];
  for (const place of PLACES) {
    const query = `[out:json][timeout:45];(nwr(around:${place.radius},${place.lat},${place.lon})[shop][name];nwr(around:${place.radius},${place.lat},${place.lon})[amenity~"^(cafe|restaurant|fast_food|food_court|ice_cream|pharmacy|doctors|dentist|clinic|bar|pub|nightclub|biergarten|fuel|cinema|theatre|veterinary)$"][name];nwr(around:${place.radius},${place.lat},${place.lon})[tourism~"^(hotel|hostel|guest_house|museum)$"][name];nwr(around:${place.radius},${place.lat},${place.lon})[leisure~"^(fitness_centre|sports_centre|swimming_pool)$"][name];);out tags;`;
    const filename = `osm-${hash(place.name).slice(0, 12)}.json`;
    console.log(`Loading public places: ${place.name}`);
    let response: string | undefined;
    for (const endpoint of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]) {
      try { response = await cached(filename, endpoint, new URLSearchParams({ data: query }).toString()); break; }
      catch (error) { console.log(`Overpass unavailable for ${place.name}: ${(error as Error).message}; pausing before next endpoint`); await new Promise((resolve) => setTimeout(resolve, 10000)); }
    }
    if (!response) { missing.push(place.name); continue; }
    const data = JSON.parse(response) as { elements: Place[]; remark?: string };
    if (data.remark || !data.elements?.length) throw new Error(`Incomplete OSM response for ${place.name}`);
    all.push({ place, elements: data.elements.filter((e) => e.tags?.name && !fromTags(e.tags).unclear) });
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  if (missing.length) throw new Error(`Overpass unavailable for ${missing.join(", ")}; rerun to use cached completed queries`);
  return all;
}
