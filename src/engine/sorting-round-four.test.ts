import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILT_IN_CATEGORIES, DEFAULT_CATEGORIES, starterCategory } from "./index.js";
import { merchantKey } from "./sorting/merchant.js";
import { cardVenuePurpose } from "./sorting/payment-purpose.js";
import { findShop } from "./sorting/starter-rules.js";
import { sortPayments } from "./sorting/sort.js";

// Invented transactions only. Business words describe trades; brands come from the pinned public NSI list.
const all = [...DEFAULT_CATEGORIES, ...BUILT_IN_CATEGORIES];
const category = (counterparty: string, description = "", amount = -19) =>
  starterCategory({ counterparty, description, amount }, all);
const envelope = (name: string) => `Empfänger: ${name} Kto/IBAN: DE09000000000000000001 Buchungstext: ${name} Beispielstadt DE`;

test("labelled bank recipients expose whole merchants without changing learned keys", () => {
  for (const prefix of ["", "Worldline *", "NEXI *", "SUMUP *", "SPC*", "SQ *", "iZ *", "ZETTLE_", "Stripe *", "Adyen *", "Klarna *", "PAYPAL *"]) {
    assert.equal(category("", envelope(`${prefix}Only`)), "clothes", prefix);
    assert.equal(category("", envelope(`${prefix}Only Consulting`)), null, prefix);
    assert.equal(category("", envelope(`${prefix}Quarz Bistro`)), "eating-out", prefix);
    assert.equal(category("", envelope(`${prefix}Quarz Beratung`)), null, prefix);
    assert.equal(category("Quarz Person", envelope(`${prefix}Only`)), null, prefix);
  }
  const description = envelope("Worldline *Only");
  assert.equal(starterCategory({ bookingText: description, amount: -19 }, all), "clothes");
  assert.ok(merchantKey({ description }).startsWith("empfänger:"));
  for (const text of ["Empfänger: Only", "Empfänger: Only Buchungstext: Danke",
    "Empfänger: Only Kto/IBAN: unbekannt Buchungstext: Danke", `Notiz ${description}`,
    envelope("Only Lane 7"), envelope("Onlyservice")]) assert.equal(category("", text), null, text);
  assert.equal(category("", envelope("Uber"), 19), null);
});

test("distinctive NSI bicycle shops keep ambiguous brand words and partial names out", () => {
  for (const name of ["Fahrrad XXL", "Little John Bikes", "tokyobike", "Trek Bicycle", "Zweirad-Center Stadler"]) {
    assert.equal(category(`Worldline *${name} GmbH`), "hobbies", name);
    assert.equal(category(`Worldline *${name} GmbH`, "", 19), "hobbies", name);
    assert.equal(category(`${name.replaceAll(" ", "")}technik`), null, name);
  }
  for (const name of ["Giant", "Specialized", "Stella", "Trek", "Stadler", "Bike Gallery", "B.O.C."]) {
    assert.equal(category(name), null, name);
  }
});

test("meal-service phrases need every word and apply only to spending", () => {
  for (const phrase of ["Kitchen & Wine", "Kitchen and Wine", "Wine & Dine", "Wine and Dine", "Plat du Jour"]) {
    assert.equal(category(`SUMUP *Quarz ${phrase}`), "eating-out", phrase);
    assert.equal(category(`SUMUP *Quarz ${phrase}`, "", 19), null, phrase);
    assert.equal(category(`${phrase}technik`), null, phrase);
  }
  for (const text of ["Quarz Kitchen", "Kitchen Design Quarz", "Wine Quarz", "Quarz Wine Trade", "Quarz Plat",
    "Kitchen & Wineries", "Wine & Dinerware", "Quarz Jour"]) assert.equal(category(text), null, text);
});

test("reviewed NSI hospital operators require clinical names and outgoing money", () => {
  for (const name of ["Agaplesion", "Ameos", "Asklepios Kliniken", "ATOS Kliniken", "BG Kliniken", "Celenus Kliniken",
    "Gesundheitszentren Rhein-Neckar", "Helios Kliniken", "KMG Kliniken", "Median Kliniken", "Medical Park",
    "Mediclin", "Paracelsus-Kliniken", "Rhön-Klinikum", "Sana Kliniken", "Schön Klinik", "Vivantes"]) {
    assert.equal(category(`NEXI *${name}`), "health", name);
    assert.equal(category(name, "", 19), null, name);
    assert.equal(category(`${name.replace(/[ -]/gu, "")}technik`), null, name);
    assert.equal(category(name, "Gehalt", 19), "salary", name);
  }
  for (const name of ["Helios", "Median", "ATOS", "Sana", "Paracelsus", "Quarz Praxis", "Dr. Quarz", "Kliniken"])
    assert.equal(category(name), null, name);
});

test("named bars require card merchant evidence and never cash-payment or other-trade wording", () => {
  for (const name of ["Quarz Bar", "Bar Quarz", "Quarz Bar, Lounge"]) {
    for (const prefix of ["Worldline *", "NEXI *", "SUMUP *", "PAYPAL *", "ZETTLE_"]) {
      assert.equal(category(`${prefix}${name}`), "going-out", `${prefix}${name}`);
      assert.equal(category("", envelope(`${prefix}${name}`)), "going-out");
      assert.equal(category(`${prefix}${name}`, "", 19), null);
    }
    assert.equal(category(`${name}   DEU Köln   EUR 19,00 Umsatz vom 04.04.2026`), "going-out");
    assert.equal(category(name), null); // Without card evidence, "bar" is not enough.
  }
  for (const name of ["Bar", "Bar 123", "Bar EUR", "Quarz bar bezahlt", "Bar Einzahlung", "Bar Auszahlung",
    "Quarz Bar Rechnung", "Quarz Nail Bar", "Quarz Brow Bar", "Quarz Juice Bar", "Quarz Protein Bar",
    "Quarz Bar Equipment", "Quarz Bar Consulting", "Quarz Bar Association", "Quarz Bar Codes", "Quarz Barometer"]) {
    assert.equal(category(`SUMUP *${name}`), null, name);
  }
  assert.equal(category("Quarz Person", "SUMUP *Quarz Bar"), null);
  assert.equal(category("SUMUP *Quarz", "bar bezahlt"), null);
  assert.equal(category("SUMUP *Quarz Sushi Bar"), "eating-out");
  assert.equal(category("SUMUP *Quarz Coffee Bar"), "coffee-snacks");
  assert.equal(category("SUMUP *Quarz Beauty Bar"), "personal-care");
  assert.equal(starterCategory({ counterparty: "SUMUP *Quarz Bar", amount: -19 }, [{ id: "eating-out" }]), null);
  for (const amount of [undefined, 0, 19, NaN, Infinity, -Infinity]) {
    assert.equal(cardVenuePurpose({ counterparty: "SUMUP *Quarz Bar", amount }), null);
  }
  // A generic venue type must not turn unrelated bars into one shop identity, and learning still wins.
  const payment = { counterparty: "SUMUP *Quarz Bar", amount: -19, date: "2026-04-04", source: "bank" as const };
  assert.equal(findShop(payment), null);
  assert.equal(sortPayments([payment], { categories: all, learned: { [merchantKey(payment)]: "eating-out" } })[0].categoryId,
    "eating-out");
});
