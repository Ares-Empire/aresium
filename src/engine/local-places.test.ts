import assert from "node:assert/strict";
import { test } from "node:test";
import { findLocalPlace, localName, safeLocalName, type LocalPlacesData } from "./sorting/local-places.js";
import { buildLocalPlaces, inExcludedArea, intersectsExcludedArea, placeFact } from "../../scripts/local-places-build.js";
import { DEFAULT_CATEGORIES, learn, sortPayments } from "./index.js";

const make = (rows: LocalPlacesData["rows"]): LocalPlacesData => ({ version: 1, attribution: "test", source: "fictional", dataDate: "2026-01-01",
  categories: ["eating-out", "clothes", "hobbies"], towns: ["quarzhausen", "funkendorf"], rows: [...rows].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) });
const list = make([["quarzfunken", 0, [0, 0]], ["zur quarzmuehle", -1, [0, 0, 1, 1]], ["quarzfunken atelier", 2, [0, 2]]]);
const payment = (counterparty: string, description = "") => ({ counterparty, description, amount: -12, source: "bank" as const });

test("local places match exact normalised names and explicit processor separators", () => {
  for (const name of ["QUARZFUNKEN", "SUMUP *Quarzfunken", "ZETTLE_Quarzfunken", "PAYPAL *Quarzfunken", "Kartenzahlung Quarzfunken"]) {
    assert.equal(findLocalPlace(payment(name), list)?.categoryId, "eating-out", name);
  }
  assert.equal(findLocalPlace(payment("Zur Quarzmühle", "ZUR QUARZMUEHLE Quarzhausen DE"), list)?.categoryId, "eating-out");
  assert.equal(localName("Café Öl & Süß"), "cafe oel & suess");
});
test("ambiguous names require their own town, and town evidence wins", () => {
  assert.equal(findLocalPlace(payment("Zur Quarzmühle"), list), null);
  assert.equal(findLocalPlace(payment("ZUR QUARZMUEHLE QUARZHAUSEN DE"), list)?.categoryId, "eating-out");
  assert.equal(findLocalPlace(payment("ZUR QUARZMUEHLE FUNKENDORF DE"), list)?.categoryId, "clothes");
  assert.equal(findLocalPlace(payment("ZUR QUARZMUEHLE Unbekannt DE"), list), null);
  const withNational = make([["zur quarzmuehle", 0, [0, 0, 1, 1]]]);
  assert.equal(findLocalPlace(payment("ZUR QUARZMUEHLE FUNKENDORF DE"), withNational)?.categoryId, "clothes");
  assert.equal(findLocalPlace(payment("ZUR QUARZMUEHLE   DEU Funkendorf   EUR  12,00 Umsatz vom 01.01.2026"), list)?.categoryId, "clothes");
  assert.equal(findLocalPlace(payment("QUARZFUNKEN   GBR London   EUR  12,00 Umsatz vom 01.01.2026"), list), null);
  const conflict = make([["zur quarzmuehle", 0, [0, 0, 0, 1]]]);
  assert.equal(findLocalPlace(payment("Zur Quarzmühle Quarzhausen"), conflict), null);
});
test("local names reject ordinary words, truncations, references, mentions and positive money", () => {
  for (const name of ["sonne", "lieblingsstueck", "international", "einkauf", "am markt", "abc", "Zur Post", "sparkasse"]) assert.equal(safeLocalName(localName(name)), false, name);
  const unsafe = make([["lieblingsstueck", 0, []]]);
  assert.equal(findLocalPlace(payment("Lieblingsstück"), unsafe), null);
  for (const name of ["Quarzfunk", "Quarzfunkenhaus", "Fiktiv Quarzfunken", "Quarzfunken Ersatzteile", "Quarzfunken & Co.", "Quarzfunken 123456", "EREF:Quarzfunken"]) assert.equal(findLocalPlace(payment(name), list), null, name);
  assert.equal(findLocalPlace(payment("Fiktiv Person", "Quarzfunken Quarzhausen DE"), list), null);
  assert.equal(findLocalPlace({ ...payment("Quarzfunken"), amount: 12 }, list), null);
  assert.equal(findLocalPlace({ counterparty: "Quarzfunken" }, list), null);
  assert.equal(findLocalPlace({ ...payment("Quarzfunken"), amount: -Infinity }, list), null);
  assert.equal(findLocalPlace(payment("Zur Quarzmühle", "EREF:Quarzhausen"), list), null);
  assert.equal(findLocalPlace(payment("Quarzfunken Atelier Quarzhausen DE"), list)?.categoryId, "hobbies");
});
test("local places are opt in, follow existing shop and word rules, and yield to learning", () => {
  const pay = payment("Quarzfunken");
  assert.equal(sortPayments([pay], { categories: DEFAULT_CATEGORIES })[0].categoryId, null);
  assert.equal(sortPayments([pay], { categories: DEFAULT_CATEGORIES, localPlaces: list })[0].categoryId, "eating-out");
  assert.equal(sortPayments([pay], { categories: DEFAULT_CATEGORIES, localPlaces: list, learned: learn({}, pay, "gifts") })[0].source, "learned");
  const collisions = make([["rewe markt", 1, []], ["quarzfunken cafe", 1, []]]);
  assert.equal(sortPayments([payment("REWE Markt")], { categories: DEFAULT_CATEGORIES, localPlaces: collisions })[0].categoryId, "groceries");
  assert.equal(sortPayments([payment("Quarzfunken Cafe")], { categories: DEFAULT_CATEGORIES, localPlaces: collisions })[0].categoryId, "coffee-snacks");
  assert.equal(sortPayments([payment("REWE Markt")], { categories: [{ id: "clothes" }], localPlaces: collisions })[0].categoryId, null);
  assert.equal(sortPayments([pay], { categories: [{ id: "hobbies" }], localPlaces: list })[0].categoryId, null);
});
test("structural own transfers precede local matches", () => {
  const pay = { ...payment("Quarzfunken"), account: "fake-a", date: "2026-01-01", accountIban: "DE09000000000000000001", counterpartyIban: "DE79000000000000000002" };
  const incoming = { ...payment("Fiktiv Transfer"), account: "fake-b", date: "2026-01-01", accountIban: pay.counterpartyIban, counterpartyIban: pay.accountIban, amount: 12 };
  assert.equal(sortPayments([pay, incoming], { categories: DEFAULT_CATEGORIES, localPlaces: list })[0].source, "structural");
});
test("builder keeps nationwide conflicts and removes excluded names before sampling", () => {
  const a = placeFact("node/1", { name: "Zur Quarzmühle", amenity: "restaurant", "addr:city": "Quarzhausen" }, 49, 8);
  const b = placeFact("node/2", { name: "Zur Quarzmühle", shop: "clothes", "addr:city": "Funkendorf" }, 50, 8);
  const full = buildLocalPlaces([a, b], new Set(), "2026-01-01");
  assert.equal(full.data.rows[0][1], -1);
  const missing = { ...b, town: "", postcode: "" };
  assert.equal(buildLocalPlaces([a, missing], new Set(), "2026-01-01").data.rows[0][1], -1);
  const excluded = { ...b, excluded: true };
  assert.equal(buildLocalPlaces([a, excluded], new Set(), "2026-01-01", true).data.rows.length, 0);
  assert.equal(buildLocalPlaces([a], new Set([localName(a.name)]), "2026-01-01").data.rows.length, 0);
  assert.equal(buildLocalPlaces([a, { ...b, town: a.town }], new Set(), "2026-01-01").data.rows.length, 0);
  assert.equal(buildLocalPlaces([a, { ...b, category: null }], new Set(), "2026-01-01").data.rows[0][1], -1);
  assert.equal(inExcludedArea(48.249, 11.652), true);
  assert.equal(inExcludedArea(49, 8), false);
  assert.equal(intersectsExcludedArea([[48.20, 11.60], [48.30, 11.70]]), true);
  assert.equal(intersectsExcludedArea([[49, 8], [49.01, 8.01]]), false);
  const differentKind = { ...b, category: a.category, kind: "amenity=food_court" };
  assert.equal(buildLocalPlaces([a, differentKind], new Set(), "2026-01-01").data.rows[0][1], -1);
});
