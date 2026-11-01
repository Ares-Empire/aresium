import { fromTags } from "../eval/sorting/mapping.js";
import { PLACES } from "../eval/sorting/sources.js";
import { anonymisePersonNames } from "../eval/sorting/person-names.js";
import { localName, safeLocalName, type LocalPlacesData } from "../src/engine/sorting/local-places.js";

export type PlaceFact = {
  id: string; name: string; kind: string; category: string | null; alsoRight: string[]; town: string; postcode: string;
  lat?: number; lon?: number; excluded: boolean; chain: boolean;
};
export function inExcludedArea(lat: number, lon: number): boolean {
  // Same circles as the source sampler, plus 250 m for way outlines and rounding at the boundary.
  return PLACES.some((p) => {
    const radians = Math.PI / 180;
    const a = Math.sin((lat - p.lat) * radians / 2) ** 2
      + Math.cos(lat * radians) * Math.cos(p.lat * radians) * Math.sin((lon - p.lon) * radians / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= p.radius + 250;
  });
}
export function intersectsExcludedArea(points: readonly (readonly [number, number])[]): boolean {
  if (!points.length) return true;
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const [lat, lon] of points) { south = Math.min(south, lat); north = Math.max(north, lat); west = Math.min(west, lon); east = Math.max(east, lon); }
  // Conservative bounding-box intersection excludes long edges crossing a circle between vertices too.
  return PLACES.some((p) => inExcludedArea(Math.max(south, Math.min(north, p.lat)), Math.max(west, Math.min(east, p.lon))));
}
export function placeFact(id: string, tags: Record<string, string>, lat?: number, lon?: number): PlaceFact {
  const answer = fromTags(tags);
  const country = tags["addr:country"];
  return { id, name: tags["name:de"] || tags.name,
    kind: ["healthcare", "leisure", "tourism", "amenity", "shop", "office"].filter((key) => tags[key]).map((key) => `${key}=${tags[key]}`).join(";"),
    category: answer.unclear || answer.personal || country && country !== "DE" ? null : answer.best ?? null,
    alsoRight: answer.alsoRight ?? [], town: tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || "",
    postcode: /^\d{5}$/.test(tags["addr:postcode"] ?? "") ? tags["addr:postcode"] : "", lat, lon,
    excluded: lat === undefined || lon === undefined || inExcludedArea(lat, lon),
    chain: !!(tags.brand || tags["brand:wikidata"] || tags.network) };
}

export function buildLocalPlaces(facts: readonly PlaceFact[], knownNames: ReadonlySet<string>, dataDate: string, leftOut = false) {
  const groups = new Map<string, PlaceFact[]>();
  const dropped: Record<string, number> = {};
  const drop = (why: string) => { dropped[why] = (dropped[why] ?? 0) + 1; };
  // Establish conflicts BEFORE filtering by geography, missing address, chain status or safe name.
  for (const fact of facts) {
    const name = localName(fact.name);
    const group = groups.get(name) ?? [];
    group.push(fact); groups.set(name, group);
  }
  const candidates: { name: string; category: string | null; towns: [string, string][]; places: PlaceFact[] }[] = [];
  for (const [name, group] of groups) {
    if (!safeLocalName(name)) { drop("unsafeName"); continue; }
    if (knownNames.has(name) || group.some((p) => p.chain)) { drop("chain"); continue; }
    if (group.some((p) => anonymisePersonNames(p.name, "local-place-filter", knownNames).changed)) { drop("personName"); continue; }
    // Remove the entire name, not just that town's row: excluded places cannot train name-only evidence.
    if (leftOut && group.some((p) => p.excluded)) { drop("excludedAreaOrUnknownGeometry"); continue; }
    const categories = new Set(group.map((p) => p.category));
    const category = categories.size === 1 && new Set(group.map((p) => p.kind)).size === 1 ? group[0].category : null;
    const townGroups = new Map<string, Set<string | null>>();
    for (const place of group) for (const town of [place.town, place.postcode].filter(Boolean).map(localName)) {
      const set = townGroups.get(town) ?? new Set(); set.add(place.category); townGroups.set(town, set);
    }
    const towns: [string, string][] = [];
    for (const [town, set] of townGroups) if (set.size === 1 && !set.has(null)) towns.push([town, [...set][0]!]);
    const places = group.filter((p) => p.category && (p.town || p.postcode) && (category || towns.some(([town, cat]) => cat === p.category && [localName(p.town), p.postcode].includes(town))));
    if (!places.length) { drop("noSafeCategoryOrAddress"); continue; }
    candidates.push({ name, category, towns, places });
  }
  candidates.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const categories = [...new Set(candidates.flatMap((p) => [...p.towns.map(([, c]) => c), ...(p.category ? [p.category] : [])]))].sort();
  const towns = [...new Set(candidates.flatMap((p) => p.towns.map(([t]) => t)))].sort();
  const townCodes = new Map(towns.map((t, i) => [t, i]));
  const data: LocalPlacesData = {
    version: 1, attribution: "© OpenStreetMap contributors, ODbL",
    source: "https://download.geofabrik.de/europe/germany.html (OpenStreetMap); https://www.openstreetmap.org/copyright; https://opendatacommons.org/licenses/odbl/1-0/",
    dataDate, categories, towns,
    rows: candidates.map((p) => [p.name, p.category ? categories.indexOf(p.category) : -1,
      p.towns.sort(([a], [b]) => townCodes.get(a)! - townCodes.get(b)!).flatMap(([town, cat]) => [townCodes.get(town)!, categories.indexOf(cat)])]),
  };
  return { data, places: candidates.flatMap((p) => p.places), stats: { sourcePlaces: facts.length, sourceNames: groups.size,
    places: candidates.reduce((n, p) => n + p.places.length, 0), names: candidates.length,
    nameOnly: candidates.filter((p) => p.category).length, townRequired: candidates.filter((p) => !p.category).length, towns: towns.length, dropped } };
}
