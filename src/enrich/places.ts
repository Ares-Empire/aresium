// Resolves what a distinctively-named merchant actually IS by looking it up on
// OpenStreetMap (Nominatim) by name + city. Turns an opaque card descriptor like
// "Zur Alten Post München" into placeType="restaurant" (or bar / cafe / museum / …),
// which the LLM categoriser then uses to pick the right category instead of guessing.
//
// Free, no API key. Nominatim's usage policy caps us at ~1 request/second and requires
// a real User-Agent — we honour both, cache by (name, city) so repeated merchants cost
// one lookup, and store "unknown" on a miss so we never re-query the same dead end.
import { prisma } from "../lib/db.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const UA = "aresium-finance/0.1 (self-hosted personal finance tracker)";
const RATE_MS = 1100; // be a good citizen: stay under 1 req/sec
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// OSM class/type → our coarse placeType. Anything not mapped falls back to the raw
// OSM type, so a "nightclub" or "theatre" still gives the LLM a useful hint.
const TYPE_MAP: Record<string, string> = {
  restaurant: "restaurant", fast_food: "restaurant", food_court: "restaurant",
  cafe: "cafe", ice_cream: "cafe",
  bar: "bar", pub: "bar", biergarten: "bar", nightclub: "bar",
  museum: "museum", gallery: "museum", artwork: "museum", attraction: "attraction",
  theatre: "entertainment", cinema: "entertainment",
  pharmacy: "pharmacy", hospital: "health", clinic: "health", doctors: "health",
  supermarket: "groceries", convenience: "groceries", bakery: "bakery",
  clothes: "clothes", hairdresser: "personal_care", beauty: "personal_care",
  fuel: "fuel", hotel: "hotel", hostel: "hotel", fitness_centre: "fitness", gym: "fitness",
};

// Strip card-terminal noise so the query is just the merchant name.
function merchantName(counterparty: string | null, description: string): string {
  const base = (counterparty || description).replace(/\s+/g, " ").trim();
  return base
    .replace(/\b(EUR|GIROCARD|KARTENZAHLUNG|KAUF|UMSATZ.*|VOM \d.*|\d{2}\.\d{2}\.\d{2,4}.*)\b.*$/i, "")
    .replace(/\b[A-Z]{3}\b.*$/, "") // drop a trailing 3-letter country code + everything after
    .replace(/[\/.,_]+$/g, "")
    .trim()
    .slice(0, 60);
}

const looksGeneric = (name: string) => name.replace(/[^a-zäöüß]/gi, "").length < 4;

async function lookup(name: string, city: string): Promise<string | null> {
  const url = `${NOMINATIM}?q=${encodeURIComponent(`${name} ${city}`)}&format=json&limit=1&addressdetails=0&extratags=1`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "de,en" } });
    if (!res.ok) return null;
    const rows = (await res.json()) as { class?: string; type?: string }[];
    const hit = rows[0];
    if (!hit?.type) return null;
    return TYPE_MAP[hit.type] ?? (hit.class === "amenity" || hit.class === "tourism" || hit.class === "shop" ? hit.type : null);
  } catch {
    return null;
  }
}

export async function resolvePlaces(opts: { limit?: number } = {}): Promise<{ resolved: number; looked: number }> {
  // Only worth looking up when a name is distinctive and rules didn't already nail it.
  const todo = await prisma.transaction.findMany({
    where: {
      placeType: null,
      city: { not: null },
      OR: [{ categorized: false }, { categorySource: "llm" }],
    },
    select: { id: true, counterparty: true, description: true, city: true },
    orderBy: { bookingDate: "desc" },
    take: opts.limit ?? 400,
  });
  if (todo.length === 0) {
    console.log("Places: nothing to resolve.");
    return { resolved: 0, looked: 0 };
  }

  const cache = new Map<string, string>(); // "name|city" -> placeType ("unknown" = miss)
  let resolved = 0;
  let looked = 0;
  console.log(`Places: resolving up to ${todo.length} merchants via OpenStreetMap…`);

  for (const t of todo) {
    const name = merchantName(t.counterparty, t.description);
    const city = t.city as string;
    if (looksGeneric(name)) {
      await prisma.transaction.update({ where: { id: t.id }, data: { placeType: "unknown" } });
      continue;
    }
    const key = `${name.toLowerCase()}|${city.toLowerCase()}`;
    let type = cache.get(key);
    if (type === undefined) {
      type = (await lookup(name, city)) ?? "unknown";
      cache.set(key, type);
      looked++;
      if (type !== "unknown") console.log(`  ${name} · ${city} → ${type}`);
      await sleep(RATE_MS);
    }
    await prisma.transaction.update({ where: { id: t.id }, data: { placeType: type } });
    if (type !== "unknown") resolved++;
  }

  console.log(`Places: ${looked} OSM lookups, resolved ${resolved} transactions.`);
  return { resolved, looked };
}
