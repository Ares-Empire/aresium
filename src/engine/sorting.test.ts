import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CATEGORIES, BUILT_IN_CATEGORIES, merchantKey, STARTER_RULES, starterCategory, sortPayments, learn } from "./index.js";

const all = [...DEFAULT_CATEGORIES, ...BUILT_IN_CATEGORIES];
test("default categories have stable ids, exact bilingual names, groups, and counting kinds", () => {
  const expected: Record<string, string> = {
    Everyday: "groceries|Groceries|Lebensmittel;drugstore|Drugstore|Drogerie;eating-out|Eating out|Essen gehen;coffee-snacks|Coffee & snacks|Kaffee & Snacks",
    Home: "rent|Rent|Miete;utilities|Utilities|Nebenkosten;internet-phone|Internet & phone|Internet & Handy;household|Household|Haushalt;pets|Pets|Haustiere",
    "Getting around": "bus-train|Bus & train|Bus & Bahn;car-fuel|Car & fuel|Auto & Tanken;taxi-sharing|Taxi & sharing|Taxi & Sharing;travel|Travel|Reisen",
    "Health & care": "health|Health|Gesundheit;sports-fitness|Sports & fitness|Sport & Fitness;personal-care|Personal care|Körperpflege",
    "Free time": "going-out|Going out|Ausgehen;entertainment|Entertainment|Unterhaltung;hobbies|Hobbies|Hobbys;subscriptions|Subscriptions|Abos",
    Shopping: "clothes|Clothes|Kleidung;electronics|Electronics|Elektronik;shopping|Shopping|Shopping;gifts|Gifts|Geschenke",
    "Study & work": "education|Education|Bildung;work|Work|Arbeit",
    Money: "insurance|Insurance|Versicherungen;taxes|Taxes|Steuern;fees|Fees|Gebühren;memberships|Memberships|Mitgliedschaften;donations|Donations|Spenden;cash|Cash withdrawals|Abhebungen;friends|Friends|Freunde;savings-investing|Savings & investing|Sparen & Anlegen",
    Income: "salary|Salary & side jobs|Gehalt & Nebenjob;bafoeg-scholarships|BAföG & scholarships|BAföG & Stipendium;parents-family|Parents & family|Eltern & Familie;kindergeld|Kindergeld|Kindergeld;selling-things|Selling things|Verkäufe;interest-dividends|Interest & dividends|Zinsen & Dividenden;other-income|Other income|Sonstige Einnahmen",
    Other: "other|Other|Sonstiges",
  };
  assert.deepEqual(DEFAULT_CATEGORIES.map((c) => [c.group, c.id, c.name.en, c.name.de, c.kind]),
    Object.entries(expected).flatMap(([group, entries]) => entries.split(";").map((entry) => {
      const [id, en, de] = entry.split("|");
      return [group, id, en, de, id === "savings-investing" ? "transfer" : group === "Income" ? "income" : "spend"];
    })));
  assert.equal(new Set(all.map((c) => c.id)).size, all.length);
  assert.deepEqual(BUILT_IN_CATEGORIES.map((c) => c.id), ["own-transfers", "not-sorted"]);
  assert.equal(BUILT_IN_CATEGORIES[0].kind, "transfer");
});
const keys: [string, string][] = [
  ["REWE Markt GmbH Filiale 123 München", "rewe markt"],
  ["REWE Markt GmbH Fil. 456 Berlin", "rewe markt"],
  ["REWE SAGT DANKE 123456/Berlin 25.10.2026 12:34 Karte 123456789", "rewe"],
  ["REWE sagt danke 987654 München 2026-10-26 09:02:00", "rewe"],
  ["dm-drogerie markt GmbH + Co. KG Filiale 42 Berlin", "dm-drogerie markt"],
  ["dm 1234 München", "dm"], ["dm Fil. 23 Hamburg", "dm"],
  ["dm 42 München", "dm"], ["REWE 42 Berlin", "rewe"],
  ["Bäckerei Müller e.K. Berlin", "bäckerei müller"],
  ["Beispiel AG München", "beispiel"], ["Beispiel SE Hamburg", "beispiel"],
  ["SEPA-Lastschrift Stadtwerke Beispiel EREF:1234 MREF:ZZ", "stadtwerke beispiel"],
  ["SEPA-BASISLASTSCHRIFT Stadtwerke Beispiel EREF:1234", "stadtwerke beispiel"],
  ["REWE ELV123456789 München", "rewe elv"],
  ["Studio 54 GmbH Berlin", "studio 54"],
  ["XXXLutz GmbH Berlin", "xxxlutz"],
  ["REWE xxxx1234 München", "rewe"],
  ["Lastschrift: FitX GmbH CRED:DE1234", "fitx"],
  ["Kartenzahlung REWE/BERLIN 26.10.2026 13:45 CARD 123456789", "rewe"],
  ["PayPal *FOTOHAUS GmbH Berlin", "fotohaus"],
  ["PayPal (Europe) S.a.r.l. et Cie, S.C.A. PP.1234.PP . Ihr Einkauf bei Fotohaus", "fotohaus"],
  ["PayPal Europe", ""], ["", ""],
];
for (const [counterparty, expected] of keys) test(`merchant normalization: ${counterparty}`, () => {
  assert.equal(merchantKey({ counterparty }), expected);
  assert.equal(merchantKey({ counterparty: " ", description: counterparty }), expected);
});
test("merchant keys preserve shop names and umlauts, use counterparty, and avoid processor collisions", () => {
  assert.equal(merchantKey({ counterparty: "Bäckerei Süd", description: "not the merchant" }), "bäckerei süd");
  assert.notEqual(merchantKey({ counterparty: "Café Nord" }), merchantKey({ counterparty: "Café Süd" }));
  assert.equal(merchantKey({ counterparty: "PayPal Europe", description: "PP.1234.PP . Ihr Einkauf bei Bücherhaus GmbH. EREF:secret" }), "bücherhaus");
  assert.equal(merchantKey({ counterparty: "PayPal", description: "unknown seller" }), "");
  assert.equal(merchantKey({ counterparty: "PayPal Europe", description: "PayPal *Bücherhaus GmbH" }), "bücherhaus");
});
test("every starter pattern has its intended category when enabled", () => {
  for (const rule of STARTER_RULES) assert.equal(starterCategory({ counterparty: rule.pattern }, all), rule.categoryId, rule.pattern);
});
test("starter rules are gated by selected categories and match words, not fragments", () => {
  assert.equal(starterCategory({ counterparty: "REWE Markt" }, []), null);
  for (const text of ["Notdm", "Admiral", "OBIwan", "DBX", "Shellfish", "Zarathustra", "PayPal Europe", "Amazon", "eBay", "OpenAI", "Anthropic"])
    assert.equal(starterCategory({ counterparty: text }, all), null, text);
  assert.equal(starterCategory({ counterparty: "Uber Eats" }, all), "eating-out");
  assert.equal(starterCategory({ counterparty: "Uber Eats" }, [{ id: "taxi-sharing" }]), null);
  assert.equal(starterCategory({ description: "MVV Deutschlandticket" }, all), "bus-train");
});
test("learning is immutable, takes precedence, supports custom ids, and respects removed categories", () => {
  const p = { counterparty: "REWE Filiale 123 Berlin" }, next = { counterparty: "REWE Filiale 456 München" };
  const original = {};
  const learned = learn(original, p, "custom");
  assert.deepEqual(original, {});
  assert.deepEqual(sortPayments([next], { categories: [...all, { id: "custom" }], learned }), [{ categoryId: "custom", source: "learned" }]);
  assert.deepEqual(sortPayments([next], { categories: all, learned }), [{ categoryId: "groceries", source: "starter" }]);
  assert.deepEqual(sortPayments([p], { categories: [], learned }), [{ categoryId: null, source: null }]);
  assert.deepEqual(learn(learned, { description: "" }, "custom"), learned);
  assert.deepEqual(learn({}, { counterparty: "PayPal" }, "custom"), {});
  assert.equal(learn(learned, p, "groceries")[merchantKey(p)], "groceries");
});
test("learned keys do not read Object prototype values", () => {
  assert.deepEqual(sortPayments([{ counterparty: "constructor" }], { categories: all, learned: {} }), [{ categoryId: null, source: null }]);
  const learned = learn({}, { counterparty: "__proto__" }, "groceries");
  assert.equal(sortPayments([{ counterparty: "__proto__" }], { categories: all, learned })[0].categoryId, "groceries");
});

// Made-up card lines in the bank's printed format; neither the amounts nor the dates identify the merchant.
const cardLine = (merchant: string, amount = "9,47", date = "08.10.2026") =>
  `${merchant}          DEU Musterstadt            EUR   ${amount} Umsatz vom ${date} MC Hauptkarte`;

test("card keys keep only the cleaned merchant, for multiword names, punctuation and thousands", () => {
  for (const [shop, expected] of [
    ["Penny Musterstadt", "penny musterstadt"], ["Norma Musterstadt", "norma musterstadt"],
    ["Rossmann Fil. 123", "rossmann"], ["Mueller Drogerie-Markt", "mueller drogerie-markt"],
    ["Studio 54 Musterstadt", "studio 54 musterstadt"],
  ]) {
    for (const amount of ["9,47", "23,07", "1.234,50"]) {
      const line = cardLine(shop, amount);
      assert.equal(merchantKey({ description: line }), expected, line);
      assert.equal(merchantKey({ counterparty: " ", bookingText: line }), expected, line);
      assert.equal(merchantKey({ counterparty: line }), expected, line);
    }
  }
  const first = { description: cardLine("Penny Musterstadt") };
  const next = { description: cardLine("Penny Musterstadt", "23,07", "19.10.2026") };
  const paypal = { counterparty: "PayPal Europe", description: "PP.1234.PP . Ihr Einkauf bei Penny Musterstadt" };
  assert.equal(merchantKey(first), merchantKey(next));
  assert.equal(merchantKey(first), merchantKey(paypal));
  assert.equal(merchantKey({ description: "Penny Musterstadt DEU Musterstadt EUR 9,47 Umsatz vom 08.10.2026 Visa Debit" }), "penny musterstadt");
  assert.equal(merchantKey({ description: "Beispielladen          AUT Beispielort            CHF 1.234,50 Umsatz vom 08.10.2026 Visa" }), "beispielladen");
});

test("card recognition needs both the country/town and the currency/amount/date tail", () => {
  for (const line of [
    "Beispielladen EUR 9,47 Umsatz vom 08.10.2026 MC Hauptkarte",
    "Beispielladen DE Musterstadt EUR 9,47 Umsatz vom 08.10.2026 MC Hauptkarte",
    "Beispielladen DEU Musterstadt 9,47 Umsatz vom 08.10.2026 MC Hauptkarte",
    "Beispielladen DEU Musterstadt EUR 9,47 Umsatz vom MC Hauptkarte",
    "Beispielladen DEU Musterstadt EUR 9,47 Rechnung vom 08.10.2026 MC Hauptkarte",
  ]) assert.notEqual(merchantKey({ description: line }), "beispielladen", line);
  assert.equal(merchantKey({ counterparty: "Anderer Händler", description: cardLine("Penny Musterstadt") }), "anderer händler");
});

test("learning one card payment sorts the next payment and the PayPal spelling of the same shop", () => {
  const learned = learn({}, { description: cardLine("Penny Musterstadt") }, "custom");
  assert.deepEqual(learned, { "penny musterstadt": "custom" });
  const results = sortPayments([
    { description: cardLine("Penny Musterstadt", "1.234,50", "21.10.2026"), amount: -1234.5 },
    { counterparty: "PayPal Europe", description: "Ihr Einkauf bei Penny Musterstadt", amount: -7 },
  ], { categories: [...all, { id: "custom" }], learned });
  assert.deepEqual(results, Array(2).fill({ categoryId: "custom", source: "learned" }));
});

test("sortPayments shares towns proven by any card line in this batch, without changing merchant keys", () => {
  const purchases = ["Penny", "Norma", "Netto"].map((shop) =>
    ({ source: "paypal" as const, counterparty: `${shop} Musterstadt`, amount: -4.5 }));
  const evidence = { source: "bank" as const, description: cardLine("Beispielladen"), amount: -9.47 };
  assert.deepEqual(sortPayments(purchases, { categories: all }), Array(3).fill({ categoryId: null, source: null }));
  // Proof comes last, from an unrelated shop; order and which shop provided it do not matter.
  assert.deepEqual(sortPayments([...purchases, evidence], { categories: all }).slice(0, 3),
    Array(3).fill({ categoryId: "groceries", source: "starter" }));
  assert.equal(sortPayments([evidence, ...purchases], { categories: all })[1].categoryId, "groceries");
  for (const field of ["counterparty", "description", "bookingText"]) {
    assert.equal(sortPayments([purchases[0], { [field]: cardLine("Beispielladen") }], { categories: all })[0].categoryId, "groceries", field);
  }
  assert.equal(merchantKey(purchases[0]), "penny musterstadt");
  const learned = learn({}, purchases[0], "custom");
  assert.equal(sortPayments([purchases[0], evidence], { categories: [...all, { id: "custom" }], learned })[0].source, "learned");
  assert.equal(sortPayments([purchases[0], evidence], { categories: [] })[0].categoryId, null);
  assert.equal(sortPayments(purchases, { categories: all })[0].categoryId, null); // no towns leak across calls
});

test("town context adds only one proven suffix, and never turns Penny's longer names into Groceries", () => {
  const evidence = { description: cardLine("Beispielladen") };
  const names = ["Penny Anderstadt", "Penny Beispiel Musterstadt", "Penny Musterstadt Extra", "Pennyreisen Musterstadt",
    "Pennyblack", "Penny Lane 3"];
  const results = sortPayments([...names.map((counterparty) => ({ counterparty, amount: -5 })), evidence], { categories: all });
  assert.ok(results.slice(0, names.length).every((p) => p.categoryId !== "groceries"));
  const special = sortPayments([{ counterparty: "Penny Reisen", amount: -5 }, { counterparty: "Penny Mobil", amount: -5 }, evidence], { categories: all });
  assert.deepEqual(special.slice(0, 2).map((p) => p.categoryId), ["travel", "internet-phone"]);
  const unproven = { description: cardLine("Beispielladen").replace("Umsatz vom", "Rechnung vom") };
  assert.equal(sortPayments([{ counterparty: "Penny Musterstadt" }, unproven], { categories: all })[0].categoryId, null);
});
