// Builds src/engine/sorting/shops.de.json, Aresium's built-in shop list: the German rules written by hand
// (scripts/shop-list.de.ts) and brands from OpenStreetMap's name-suggestion-index (NSI), at a pinned version.
// Run with `npm run shops` (downloads NSI once, then reads it from node_modules/.cache). The engine reads only
// the JSON; nothing here runs in the app.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { DEFAULT_CATEGORIES, BUILT_IN_CATEGORIES } from "../src/engine/categories.js";
import { compileShopList } from "../src/engine/sorting/shop-matcher.js";
import { compactLength, shopWords } from "../src/engine/sorting/shop-words.js";
import {
  DENY, KEEP_SINGLE, MARKETPLACES, MERCHANTS, NSI_CONFLICTS, OSM_CATEGORIES, PLAIN_VOWEL_WORDS, RULES, SHORT_BRANDS,
  SURNAME_TRADES,
} from "./shop-list.de.js";

export const NSI = {
  name: "name-suggestion-index",
  version: "8.0.20260918",
  generated: "2026-09-18T19:50:18.997Z",
  url: "https://cdn.jsdelivr.net/npm/name-suggestion-index@8.0.20260918/dist/json/nsi.min.json",
  sha256: "85752fb28977082f6e631636f1e9b8f97513947f75aaf1338c47ffa87207f513",
  homepage: "https://github.com/osmlab/name-suggestion-index",
  checked: "2026-10-27",
  licence: "BSD-3-Clause",
  licenceText: [
    "Copyright 2026, name-suggestion-index contributors",
    "Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:",
    "1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.",
    "2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.",
    "3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.",
    "THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS \"AS IS\" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.",
  ],
} as const;

const root = new URL("../", import.meta.url);
export const SHOP_LIST_FILE = new URL("src/engine/sorting/shops.de.json", root);
const cacheFile = new URL(`node_modules/.cache/aresium/nsi-${NSI.version}.min.json`, root);

export type ShopList = {
  about: string;
  nsi: { name: string; version: string; generated: string; url: string; sha256: string; homepage: string; checked: string;
    licence: string; licenceText: readonly string[] };
  /** Hand-written word rules, in priority order: [category id, names]. */
  rules: [string, string[]][];
  /** Hand-written names that count only as the whole merchant name ("PENNY 1234" yes, "Penny Lane" no). */
  merchants: [string, string[]][];
  /** NSI brands by category; within NSI the more specific (longer) name wins. */
  brands: [string, string[]][];
  /** Plain-vowel spellings never used because they are other words. */
  plainVowelWords: string[];
};
type NsiItem = { displayName: string; locationSet: { include?: unknown[]; exclude?: unknown[] };
  matchNames?: string[]; tags: Record<string, string>; fromTemplate?: boolean };
type NsiFile = { _meta: { version: string }; nsi: Record<string, { items: NsiItem[] }> };

const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");
async function loadNsi(): Promise<NsiFile> {
  let text: string | null = null;
  try { text = await readFile(cacheFile, "utf8"); } catch { /* not downloaded yet */ }
  if (text === null || sha256(text) !== NSI.sha256) {
    const response = await fetch(NSI.url);
    if (!response.ok) throw new Error(`NSI download failed: HTTP ${response.status}`);
    text = await response.text();
    if (sha256(text) !== NSI.sha256) throw new Error("NSI download does not match the pinned SHA-256");
    await mkdir(new URL("./", cacheFile), { recursive: true });
    await writeFile(cacheFile, text);
  }
  const file = JSON.parse(text) as NsiFile;
  if (file._meta.version !== NSI.version) throw new Error(`NSI version ${file._meta.version}, expected ${NSI.version}`);
  return file;
}

// Germany, Europe, the European Union, Western Europe, the world, a German state, or a German brand's own area.
const GERMAN_AREAS = new Set(["de", "001", "150", "155", "eu",
  "aldi-sued.geojson", "konsum-dresden.geojson", "konsum-leipzig.geojson", "stadtmobil-suedbaden.geojson"]);
function inGermany(item: NsiItem): boolean {
  const codes = (list: unknown[] | undefined) => (list ?? []).map((code) => String(code).toLowerCase());
  if (codes(item.locationSet.exclude).includes("de")) return false;
  return codes(item.locationSet.include).some((code) => GERMAN_AREAS.has(code) || code.startsWith("de-"));
}
function itemNames(path: string, item: NsiItem): string[] {
  const keys = path.startsWith("transit/") ? ["network", "operator"] : ["name", "brand", "name:de", "brand:de"];
  return [...keys.map((key) => item.tags[key]), ...(item.matchNames ?? [])].filter((name): name is string => !!name);
}

const key = (name: string) => shopWords(name).join(" ");
const keySet = (names: readonly string[]) => new Set(names.map(key));
const umlautCount = (name: string) => (name.match(/[äöüß]/gu) ?? []).length;
const categoryOrder = [...DEFAULT_CATEGORIES, ...BUILT_IN_CATEGORIES].map((c) => c.id);
const byCategory = (a: [string, unknown], b: [string, unknown]) => categoryOrder.indexOf(a[0]) - categoryOrder.indexOf(b[0]);

export type BuildReport = { list: ShopList; dropped: Record<string, string[]>; conflicts: string[] };

/** Pure: the shop list from the NSI file and the decisions. Fails on an unknown category or an undecided conflict. */
export function buildShopList(nsi: NsiFile): BuildReport {
  const known = new Set(categoryOrder);
  const ids = [...Object.values(OSM_CATEGORIES), ...RULES.map(([id]) => id), ...MERCHANTS.map(([id]) => id),
    ...Object.values(NSI_CONFLICTS).filter((id): id is string => id !== null)];
  for (const id of ids) if (!known.has(id)) throw new Error(`Unknown category id: ${id}`);
  const deny = keySet(DENY), short = keySet(SHORT_BRANDS), keepSingle = keySet(KEEP_SINGLE), marketplaces = keySet(MARKETPLACES);
  // The engine's own matcher with the hand-written part only: a brand it already sorts never reaches NSI.
  const handWritten = compileShopList({ rules: RULES, merchants: MERCHANTS, brands: [], plainVowelWords: PLAIN_VOWEL_WORDS });
  const dropped: Record<string, Set<string>> = {};
  const drop = (reason: string, name: string) => (dropped[reason] ??= new Set()).add(name);
  // key → { the spelling kept in the file, the categories its items point to }
  const found = new Map<string, { name: string; categories: Set<string> }>();
  for (const [path, categoryId] of Object.entries(OSM_CATEGORIES)) {
    for (const item of nsi.nsi[path]?.items ?? []) {
      if (item.fromTemplate || !inGermany(item)) continue; // car makes copied into car repair; other countries
      for (const raw of itemNames(path, item)) {
        const name = raw.normalize("NFC").toLowerCase().trim();
        const k = key(name);
        const words = k.split(" ");
        if (!/^[a-z0-9&+ ]+$/u.test(k)) drop("not in Latin letters", name);
        else if (!/[a-z]/u.test(k)) drop("no letters", name);
        else if (words.some((w) => marketplaces.has(w))) drop("marketplace or payment service", name);
        else if (deny.has(k)) drop("deny list", name);
        else if (compactLength(name) <= 3 && !short.has(k)) drop("three characters or fewer", name);
        else if (words.length === 1 && SURNAME_TRADES.includes(path) && !keepSingle.has(k)) drop("one word in a family-name trade", name);
        else {
          const covering = handWritten.match({ counterparty: name });
          if (covering) {
            // Reported separately: such a brand is sorted by the hand-written rule, so its category should agree.
            if (covering === categoryId) drop("covered by a hand-written rule", name);
            else drop("covered by a hand-written rule of another category", `${name} (${categoryId}; rule: ${covering})`);
            continue;
          }
          const entry = found.get(k) ?? { name, categories: new Set<string>() };
          // Keep the spelling with umlauts: it also yields the plain-vowel spelling some terminals print.
          if (umlautCount(name) > umlautCount(entry.name) || (umlautCount(name) === umlautCount(entry.name) && name < entry.name)) entry.name = name;
          entry.categories.add(categoryId);
          found.set(k, entry);
        }
      }
    }
  }
  const conflicts: string[] = [];
  const brands = new Map<string, Set<string>>();
  for (const [k, { name, categories }] of found) {
    let categoryId = categories.size === 1 ? [...categories][0] : undefined;
    if (Object.hasOwn(NSI_CONFLICTS, k)) {
      const decided = NSI_CONFLICTS[k];
      if (decided === null) { drop("in two categories, left out", name); continue; }
      categoryId = decided;
    } else if (categoryId === undefined) {
      conflicts.push(`${k}: ${[...categories].join(", ")}`);
      continue;
    }
    const names = brands.get(categoryId) ?? new Set<string>();
    names.add(name);
    brands.set(categoryId, names);
  }
  const list: ShopList = {
    about: "Aresium's built-in shop list for Germany. Generated by scripts/build-shop-list.ts from scripts/shop-list.de.ts "
      + "and the name-suggestion-index (nsi); do not edit by hand. Brand data © name-suggestion-index contributors, BSD-3-Clause (licence below).",
    nsi: { ...NSI },
    rules: RULES.map(([id, names]) => [id, [...names]]),
    merchants: MERCHANTS.map(([id, names]) => [id, [...names]] as [string, string[]]).sort(byCategory),
    brands: [...brands].map(([id, names]) => [id, [...names].sort()] as [string, string[]]).sort(byCategory),
    plainVowelWords: [...PLAIN_VOWEL_WORDS],
  };
  return { list, conflicts, dropped: Object.fromEntries(Object.entries(dropped).map(([reason, names]) => [reason, [...names].sort()])) };
}

function count(list: ShopList): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [id, names] of [...list.rules, ...list.merchants, ...list.brands]) counts.set(id, (counts.get(id) ?? 0) + names.length);
  return counts;
}

export async function writeShopList(): Promise<void> {
  const { list, conflicts, dropped } = buildShopList(await loadNsi());
  if (conflicts.length) throw new Error(`Decide these brands in NSI_CONFLICTS (scripts/shop-list.de.ts):\n${conflicts.join("\n")}`);
  let before: ShopList | null = null;
  try { before = JSON.parse(await readFile(SHOP_LIST_FILE, "utf8")) as ShopList; } catch { /* first run */ }
  await writeFile(SHOP_LIST_FILE, JSON.stringify(list, null, 2) + "\n");
  for (const [reason, names] of Object.entries(dropped)) console.log(`Left out (${reason}): ${names.length}`);
  const counts = count(list);
  console.log([...counts].sort(byCategory).map(([id, n]) => `${id} ${n}`).join(", "));
  console.log(`Wrote ${SHOP_LIST_FILE.pathname}: ${[...counts.values()].reduce((a, b) => a + b, 0)} names`);
  if (before) {
    // What changed, for review: every new NSI name should be a shop, not a word or a surname.
    const names = (l: ShopList) => new Set(l.brands.flatMap(([id, ns]) => ns.map((n) => `${id}: ${n}`)));
    const old = names(before), now = names(list);
    const added = [...now].filter((n) => !old.has(n)), removed = [...old].filter((n) => !now.has(n));
    if (added.length) console.log(`New NSI names:\n  ${added.join("\n  ")}`);
    if (removed.length) console.log(`Removed NSI names:\n  ${removed.join("\n  ")}`);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await writeShopList();
