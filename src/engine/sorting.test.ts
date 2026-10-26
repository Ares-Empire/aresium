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
    Money: "insurance|Insurance|Versicherungen;taxes|Taxes|Steuern;fees|Fees|Gebühren;memberships|Memberships|Mitgliedschaften;donations|Donations|Spenden;cash|Cash|Bargeld;friends|Friends|Freunde;savings-investing|Savings & investing|Sparen & Anlegen",
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
  for (const text of ["Notdm", "Admiral", "OBIwan", "DBX", "Shellfish", "Zarathustra", "PayPal Europe", "Amazon", "eBay", "Vinted", "OpenAI", "Anthropic"])
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
