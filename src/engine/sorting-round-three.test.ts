import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILT_IN_CATEGORIES, DEFAULT_CATEGORIES, starterCategory } from "./index.js";
import { compileShopList } from "./sorting/shop-matcher.js";

// Invented payments, in the formats printed by banks. No benchmark names or private transactions.
const all = [...DEFAULT_CATEGORIES, ...BUILT_IN_CATEGORIES];
const category = (counterparty: string, description = "", amount = -19) =>
  starterCategory({ counterparty, description, amount }, all);

test("chains tolerate terminal spacing, apostrophes, combined brands and specific legal names", () => {
  for (const name of ["MC DONALDS 2345 DEU KÖLN", "Mc Donald's", "Mc Donald s", "McDonald s"]) {
    assert.equal(category(name), "eating-out", name);
  }
  assert.equal(category("MEDIAMARKTSATURN GmbH"), "electronics");
  assert.equal(category("Bauhaus E-Business Gesellschaft für Bau- und Hausbedarf mbH"), "household");
  for (const suffix of ["Aktiengesellschaft", "AG"]) {
    assert.equal(category(`Autobahnen- und Schnellstraßen-Finanzierungs-${suffix}`), "car-fuel");
  }
  assert.equal(category("O NEILL 1234 Beispielstadt"), "clothes");
  for (const name of ["Mc Donaldson Consulting", "Mc Donaldsservice", "Mediamarktsaturntechnik", "Bauhaus Design Institut",
    "Bauhaus E-Learning", "Autobahnen Planungs GmbH", "Schnellstraßen Finanzierung Beratung", "O Neill Consulting"]) {
    assert.equal(category(name), null, name);
  }
  const matcher = compileShopList({ rules: [], merchants: [], brands: [["electronics", ["Quarz Technik"]]] });
  assert.equal(matcher.match({ counterparty: "QUARZTECHNIK 123" }), "electronics");
  assert.equal(matcher.match({ counterparty: "Quarztechnikberatung" }), null);
  assert.equal(matcher.match({ counterparty: "Vorquarztechnik" }), null);
  const collision = compileShopList({ rules: [], merchants: [],
    brands: [["electronics", ["Quarz Technik"]], ["clothes", ["Quarztechnik"]]] });
  assert.equal(collision.match({ counterparty: "Quarztechnik" }), "clothes");
  assert.equal(collision.match({ counterparty: "Quarz Technik" }), "electronics");
});

test("business compounds require descriptive endings and keep the spending direction", () => {
  for (const [name, expected] of [
    ["Grillhütte", "eating-out"], ["GRILLHUTTE", "eating-out"], ["Kaffeekontor", "coffee-snacks"],
    ["Kaffeehaus", "coffee-snacks"], ["Haarwerkstatt", "personal-care"], ["Hairdesign", "personal-care"],
    ["Haaratelier", "personal-care"], ["Lebensmittelmarkt", "groceries"],
  ]) {
    assert.equal(category(`SPC*${name} Quarz`), expected, name);
    assert.equal(category(name, "", 19), null, name);
    assert.equal(category(`${name}technik`), null, name);
  }
  for (const name of ["Grillparzer Straße", "Grillanzünder", "Kaffeefahrt", "Kaffeemaschinen", "Haaranalyse", "Hairbrush"]) {
    assert.equal(category(name), null, name);
  }
});

test("clear cutoffs require the field end and short medical stems require practice context", () => {
  for (const [name, expected] of [
    ["Quarz HAIRST.", "personal-care"], ["Quarz HAIRST", "personal-care"], ["Quarz Hairstyl…", "personal-care"],
    ["Quarz Lebensmit.", "groceries"], ["Quarz Lebensmitt", "groceries"],
    ["Praxis fur Podo…", "health"], ["Praxis für Podologi", "health"],
  ]) {
    assert.equal(category(name), expected, name);
    assert.equal(category(name, "", 19), null, name);
    assert.equal(category("", name), expected, name);
    assert.equal(category(`${name} Consulting`), null, name);
    assert.equal(category(`${name} EREF:123`), null, name);
  }
  assert.equal(category("Quarz Lebensmit.", "Rechnung 123"), "groceries");
  assert.equal(category("Quarz Lebensmit EREF:Lebensmit"), null);
  assert.equal(category("Quarz HAIRST.   DEU Köln   EUR 19,00 Umsatz vom 04.04.2026"), "personal-care");
  for (const name of ["Haar", "Hair", "Haist", "Hairstein", "Lebensmi", "Lebensmitberatung", "Podo", "Praxis", "Praxis fur Po", "Podolski"]) {
    assert.equal(category(name), null, name);
  }
});

test("SPC separators expose the merchant, preserving whole-name and branch restrictions", () => {
  for (const prefix of ["SPC*", "spc *", "Kartenzahlung SPC*"]) {
    assert.equal(category(`${prefix}Only`), "clothes");
    assert.equal(category(`${prefix}Only 234 Beispielstadt`), "clothes");
    assert.equal(category("", `${prefix}Only`), "clothes");
    for (const name of ["Only Consulting", "Only Lane 17", "Onlyservice", "Only 12:30 Hinterort", "Only 1234567 Hinterort"]) {
      assert.equal(category(`${prefix}${name}`), null, name);
    }
    assert.equal(category(`${prefix}Uber`, "", 19), null);
  }
  assert.equal(category("SPC"), null);
  assert.equal(category("SPC Only"), null);
  assert.equal(category("Quarz Person", "SPC*Only"), null);
});

test("town suffixes tolerate blank umlauts and long cutoffs only with location evidence", () => {
  for (const town of ["K LN", "M NCHEN", "KOLN", "MUNCHEN", "KOELN", "MUENCHEN"]) {
    assert.equal(category(`Only ${town} DE`), "clothes", town);
    assert.equal(category(`Only Consulting ${town} DE`), null, town);
  }
  const matcher = compileShopList({ rules: [], merchants: [["clothes", ["only"]]], brands: [] });
  assert.equal(matcher.match({ counterparty: "Only GARCHIN DE" }, ["Garching"]), "clothes");
  assert.equal(matcher.match({ counterparty: "Only GARCHIN" }, ["Garching"]), null);
  assert.equal(matcher.match({ counterparty: "Only GARCH DE" }, ["Garching"]), null);
  assert.equal(category("Only Consulting DE"), null);
  assert.equal(category("M LLER DROGERIE"), "drugstore");
  assert.equal(category("H FFNER"), "household");
  assert.equal(category("H FFNERTECHNIK"), null);
  assert.equal(category("K. Chen"), null); // Do not reinterpret a name as damaged Küchen.
});

test("regional utility names come from a general source, with whole-merchant restrictions for short names", () => {
  for (const name of ["123energie", "Allgäuer Überlandwerk", "Avacon", "Bayernwerk", "Bigge Energie", "BS Energy", "e-regio",
    "E-Werk Mittelbaden", "EBERwerk", "eins energie in sachsen", "Emscher Lippe Energie", "Energie Calw", "Energie SaarLorLux",
    "Energie und Wasser Potsdam", "Energiedienst", "energis", "enviaM", "envia mitteldeutsche energie", "FairEnergie",
    "Herzo Werke", "Inselwerke", "Kreiswerke Main-Kinzig", "Lechwerke", "LokalWerke", "LSW Energie", "Maingau", "Mark-E",
    "NaturEnergie", "Pfalzwerke", "regionalwerk Bodensee", "Rewag", "RhönEnergie Fulda", "Stadtwerk am See", "STAWAG",
    "Süwag", "TEAG Thüringer Energie", "Thüringer Energie", "WEMAG", "Westenergie", "ZEAG Energie"]) {
    assert.equal(category(`SPC*${name} GmbH`), "utilities", name);
    assert.equal(category(name, "", 19), "utilities", name);
    assert.equal(category(`${name.replaceAll(" ", "")}beratung`), null, name);
  }
  for (const name of ["EWV", "EAM", "EWR", "EVO", "AVU", "ESWE", "GGEW", "OVAG", "TEAG", "swb"]) {
    assert.equal(category(`SPC*${name}`), "utilities", name);
    assert.equal(category(`${name} Consulting`), null, name);
    assert.equal(category("Quarz Person", name), null, name);
  }
  for (const word of ["Gemeindewerke", "Regionalwerk", "Kreiswerke"]) {
    assert.equal(category(`${word} Quarzstadt`), "utilities");
    assert.equal(category(`${word}technik`), null);
    assert.equal(category(`${word} Quarzstadt`, "", 19), null);
  }
  assert.equal(category("Bayernwerk", "Gehalt", 19), "salary");
});

test("car makers require a whole payee and outgoing money; dealership words describe the business", () => {
  for (const brand of ["Abarth", "Acura", "Aixam", "Alfa Romeo", "Aston Martin", "Audi", "Bentley", "BMW", "BYD",
    "Cadillac", "Chevrolet", "Chrysler", "Citroën", "Cupra", "Dacia", "Daihatsu", "Dodge", "Ferrari", "Fiat", "Ford", "Honda",
    "Hyundai", "Infiniti", "Isuzu", "Jeep", "Kia", "Koenigsegg", "Lamborghini", "Lancia", "Land Rover", "Maserati", "Mazda",
    "McLaren", "Mercedes-Benz", "Mitsubishi", "Nissan", "Opel", "Peugeot", "Polestar", "Porsche", "Range Rover", "Renault",
    "Rolls-Royce", "Skoda", "SsangYong", "Subaru", "Suzuki", "Toyota", "Vauxhall", "Volkswagen", "Volvo", "Xpeng", "BP", "Q1", "OIL!"]) {
    assert.equal(category(`SPC*${brand} GmbH`), "car-fuel", brand);
    assert.equal(category(`${brand} 123 Quarzstadt`), "car-fuel", brand);
    assert.equal(category(brand, "", 19), null, brand);
    assert.equal(category(`${brand} Consulting`), null, brand);
    assert.equal(category("Quarz Person", `Anteil ${brand}`), null, brand);
    assert.equal(category(`${brand}technik`), null, brand);
  }
  for (const word of ["Motors", "Automobile", "Autozentrum", "Audi Zentrum", "Autohaus"]) {
    assert.equal(category(`Quarz ${word}`), "car-fuel", word);
    assert.equal(category(`Quarz ${word}`, "", 19), null, word);
    assert.equal(category(`${word.replaceAll(" ", "")}beratung`), null, word);
  }
  for (const text of ["BMW Welt", "Mercedes Beispiel", "Smart", "Mini", "Seat", "Motor", "Motorsportclub"]) {
    assert.equal(category(text), null, text);
  }
  assert.equal(category("BMW", "Gehalt", 19), "salary");
  assert.equal(category("Bugatti GmbH"), "clothes"); // Also a clothing brand; no unconditional car override.
});

test("charging operators use distinctive names, never fragments or host companies", () => {
  for (const name of ["Wirelane", "Allego", "EVBox", "LEAP24", "Citywatt", "Comfortcharge", "Qwello", "reev", "E-Flux", "Ladeverbund+", "Autostrom plus"]) {
    assert.equal(category(`${name} GmbH`), "car-fuel", name);
    assert.equal(category(`${name.replaceAll(" ", "").replaceAll("+", "")}technik`), null, name);
  }
  assert.equal(category("EnBW mobility+"), "car-fuel");
  assert.equal(category("EnBW Energie"), "utilities");
  assert.equal(category("Aldi GmbH"), "groceries");
  assert.equal(category("Airbus GmbH"), null);
  assert.equal(category("Wirelane", "Gehalt", 19), "salary");
});

test("associations are a spending fallback after specific business purposes", () => {
  for (const name of ["Quarzfreunde e.V.", "Quarzfreunde e. V.", "Quarzfreunde e.V", "Quarzfreunde eingetragener Verein"]) {
    assert.equal(category(name, "Beitrag"), "memberships", name);
    assert.equal(category(name, "", 19), null, name);
    assert.equal(starterCategory({ counterparty: name, amount: -19 }, [{ id: "health" }]), null);
  }
  for (const name of ["Quarz EV Solutions", "Quarz e.V.beratung", "Quarz Person"]) assert.equal(category(name), null, name);
  assert.equal(category("Quarz Person", "Danke EREF:e.V."), null);
  assert.equal(category("Quarzfreunde e.V.", "Spende"), "donations");
  assert.equal(category("Goethe-Institut e.V."), "education");
  assert.equal(category("Quarzfreunde e.V.", "Gehalt", 19), "salary");
  assert.equal(category("Quarzfreunde e.V.", "Tenniskurs"), "memberships");
  assert.equal(category("TGV 1861 e.V.", "Beitrag"), "memberships");
});

test("dues, trade unions and political parties use bounded wording and outgoing money", () => {
  for (const word of ["Vereinsbeiträge", "Vereinsmitgliedschaft", "Mitgliedsgebühr", "Mitgliedsgebühren", "Parteibeitrag",
    "Parteibeiträge", "Gewerkschaftsbeitrag", "Gewerkschaftsbeiträge", "Clubbeitrag", "Clubbeiträge", "Klubbeitrag", "Klubbeiträge"]) {
    assert.equal(category("Quarz", word), "memberships", word);
    assert.equal(category("Quarz", word, 19), null, word);
    assert.equal(category(`${word}beratung`), null, word);
  }
  for (const name of ["SPD", "CDU", "CSU", "FDP", "AfD", "Bündnis 90 Die Grünen", "Die Linke",
    "Sozialdemokratische Partei Deutschlands", "Christlich Demokratische Union", "Christlich Demokratische Union Deutschlands",
    "Christlich Soziale Union", "Christlich Soziale Union in Bayern",
    "Freie Demokratische Partei", "Alternative für Deutschland", "GEW", "NGG", "GdP", "EVG"]) {
    assert.equal(category(name), "memberships", name);
    assert.equal(category(`${name}beratung`), null, name);
    assert.equal(category(name, "", 19), null, name);
    assert.equal(category("Quarz Person", name), null, name);
  }
  assert.equal(category("IG BAU Bezirksverband Quarz"), "memberships");
  assert.equal(category("IG BCE Bezirk Quarz"), "memberships");
  for (const word of ["Beitrag", "Jahresbeitrag", "Club", "Partei", "Union"]) assert.equal(category("Quarz", word), null, word);
});

test("explicit canteen purchases override their host's name, with bounded words and spending only", () => {
  for (const word of ["Kantine", "Betriebskantine", "Mensa"]) {
    assert.equal(category(`Finanzamt Quarz ${word}`), "eating-out", word);
    assert.equal(category(`Quarz ${word}`, "", 19), null, word);
    assert.equal(category(`Quarz ${word}technik`), null, word);
    assert.equal(category("Quarz", `EREF:${word}`), null, word);
  }
  assert.equal(category("Finanzamt Quarz", "Einkommensteuer"), "taxes");
  assert.equal(category("Quarz Betriebskantine", "Gehalt", 19), "salary");
});

test("specific descriptive health, food and retail terms keep boundaries and spending direction", () => {
  for (const [id, names] of [
    ["health", ["Gemeinschaftspraxis", "Salzgrotte"]], ["coffee-snacks", ["Baumkuchenhaus"]],
    ["eating-out", ["Chicken", "Mezedes", "Kimchi", "Simit", "Spanferkel", "Ratskeller"]],
    ["hobbies", ["Books", "Bookshop", "Bücherladen"]], ["electronics", ["Computer"]],
  ] as [string, string[]][]) for (const name of names) {
    assert.equal(category(`SPC*Quarz ${name}`), id, name);
    assert.equal(category(name, "", 19), null, name);
    assert.equal(category(`${name}technik`), null, name);
  }
});

test("the NSI bakery chain correction keeps longer unrelated names out", () => {
  assert.equal(category("Cinnabon GmbH"), "coffee-snacks");
  assert.equal(category("Cinnabon GmbH", "", 19), "coffee-snacks");
  assert.equal(category("Cinnabontechnik"), null);
});
