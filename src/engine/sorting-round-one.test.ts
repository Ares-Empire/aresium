import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILT_IN_CATEGORIES, DEFAULT_CATEGORIES, learn, sortPayments, STARTER_RULES, starterCategory } from "./index.js";
import { buildShopList, NSI } from "../../scripts/build-shop-list.js";
import { findShop } from "./sorting/starter-rules.js";

const all = [...DEFAULT_CATEGORIES, ...BUILT_IN_CATEGORIES];
const category = (counterparty: string, description = "", amount = -19) =>
  starterCategory({ counterparty, description, amount }, all);

test("marketplace proceeds require incoming money and explicit sale or payout wording", () => {
  for (const platform of ["Vinted", "Kleiderkreisel", "eBay", "Kleinanzeigen", "rebuy"]) {
    for (const text of ["Auszahlung", "Verkauf", "Verkaufserlös", "Verkaufserloese"]) {
      assert.equal(category(platform, text, 19), "selling-things", `${platform} ${text}`);
      assert.notEqual(category(platform, text, -19), "selling-things");
      assert.notEqual(category(platform, text, 0), "selling-things");
      assert.notEqual(starterCategory({ counterparty: platform, description: text }, all), "selling-things");
    }
    for (const text of ["", "Rueckzahlung", "Auszahlung Erstattung", "Verkauf storniert", "Verkauf Rückgabe", "Verkauf Rückabwicklung", "Verkauf storniert Refund"]) {
      assert.equal(category(platform, text, 19), null, `${platform} ${text}`);
    }
    assert.equal(category(`${platform}service`, "Verkauf", 19), null);
  }
  for (const platform of ["momox", "wirkaufens", "zoxs"]) assert.equal(category(platform, "Ankauf", 19), "selling-things");
  assert.equal(category("Beispiel GmbH", "Auszahlung", 19), null);
  assert.equal(category("Beispiel GmbH", "Auszahlung EREF:ebay", 19), null);
  assert.equal(category("Vinted", "Rechnung MREF:Auszahlung", 19), null);
  const sale = { counterparty: "Vinted", description: "Auszahlung Verkauf", amount: 19 };
  assert.equal(starterCategory(sale, [{ id: "clothes" }]), null);
  assert.equal(sortPayments([sale], { categories: all, learned: learn({}, sale, "gifts") })[0].categoryId, "gifts");
});

test("florists and gift shops use whole business words, only on money out", () => {
  for (const word of ["Floristik", "Florist", "Blumenladen", "Blumen", "Blumenhaus", "Geschenke", "Geschenkeladen", "Geschenkshop"]) {
    assert.equal(category(`SUMUP *${word} Beispiel`), "gifts", word);
    assert.equal(category(`${word} Beispiel`, "", 19), null, word);
    assert.equal(category(`${word}weg Beispiel`), null, word);
  }
  assert.equal(category("Blumenstraße 17"), null);
});

test("food words match whole words, keep direction, and reject unrelated longer names", () => {
  const blocks: [string, string[]][] = [
    ["eating-out", ["grill", "grillhaus", "grillrestaurant", "schnellrestaurant", "burrito", "burritos", "veggie", "vegan",
      "ramen", "pho", "poke", "bowl", "bowls", "noodle", "noodles", "falafel", "brasserie", "burger", "onigiri",
      "street food", "thai food", "hot dog", "ocakbaşı", "ocakbasi", "banh mi", "taverna", "trattoria", "osteria", "wirtshaus", "gasthaus"]],
    ["coffee-snacks", ["croissant", "croissants", "croissanterie", "brotmanufaktur", "backhaus", "kaffeerösterei", "caffè",
      "gelato", "pasticceria", "waffle", "waffeln", "confiserie", "milchbar", "fladenbrot", "backstube"]],
    ["groceries", ["bauernhof", "feinkost", "helal markt", "tee contor", "hofladen"]],
    ["going-out", ["brauhaus"]],
  ];
  for (const [id, words] of blocks) for (const word of words) {
    assert.equal(category(`SQ *${word} Beispiel`), id, word);
    assert.equal(category(`SQ *${word} Beispiel`, "", 19), null, word);
    assert.equal(category(`${word.replaceAll(" ", "")}technik GmbH`), null, word);
  }
  for (const name of ["Grillparzer Straße", "Backup GmbH", "Photoatelier", "Pokémon", "Bowlingtechnik", "Nudelmaschinenbau"]) {
    assert.equal(category(name), null, name);
  }
  assert.equal(category("OCAKBAŞI Beispiel"), "eating-out");
});

test("only descriptive food-business endings match inside compounds", () => {
  for (const [name, id, negative] of [
    ["Seerestaurant", "eating-out", "Restauranttechnik"], ["Fischimbiss", "eating-out", "Imbissbedarf"],
    ["Stadtbäckerei", "coffee-snacks", "Bäckereimaschinen"], ["Stehcafé", "coffee-snacks", "Cafeteriatechnik"],
    ["Biobackstube", "coffee-snacks", "Backstubentechnik"], ["Biohofladen", "groceries", "Hofladensoftware"],
  ]) {
    assert.equal(category(name), id, name);
    assert.equal(category(negative), null, negative);
    assert.equal(category(name, "", 19), null, name);
  }
});

test("explicit processor separators preserve whole-merchant and branch restrictions", () => {
  for (const prefix of ["SUMUP *", "SQ *", "iZ *", "iZettle *", "ZETTLE_", "Stripe *", "Adyen *", "Klarna *", "NEXI *", "Worldline *"]) {
    for (const name of ["Only", "Only 123 Musterstadt", "Only Filiale 123"]) {
      assert.equal(category(`${prefix}${name}`), "clothes", `${prefix}${name}`);
      assert.equal(category("", `${prefix}${name}`), "clothes");
      assert.equal(findShop({ counterparty: `${prefix}${name}`, amount: -19 })?.name, "only");
    }
    for (const name of ["Only Example Consulting", "Only Lane 17", "Onlyservice", "Only 1234567 Hinterort", "Only 12:30 Hinterort"]) {
      assert.equal(category(`${prefix}${name}`), null, `${prefix}${name}`);
    }
    assert.equal(category("Beispiel Person", `${prefix}Only`), null);
    assert.equal(category(`${prefix}Uber`, "", 19), null);
  }
  assert.equal(category("Klarna Only"), null); // no explicit merchant separator
  assert.equal(category("Only Musterstadt DE"), null); // no town evidence
  const payments = [{ counterparty: "SQ *Only Musterstadt DE", amount: -19 },
    { description: "Beispiel          DEU Musterstadt            EUR 19,00 Umsatz vom 05.04.2026 MC Hauptkarte", amount: -19 }];
  assert.equal(sortPayments(payments, { categories: all })[0].categoryId, "clothes");
  assert.equal(sortPayments([{ ...payments[0], counterparty: "SQ *Only Consulting Musterstadt DE" }, payments[1]],
    { categories: all })[0].categoryId, null);
});

test("explicit non-shop purposes use their meaning and direction, never fragments or a sender's name alone", () => {
  const blocks: [string, string[], "out" | "in" | "both"][] = [
    ["personal-care", ["haarschnitt"], "out"], ["household", ["möbelkauf"], "out"], ["going-out", ["cocktails"], "out"],
    ["parents-family", ["unterstützung von eltern", "unterhalt von eltern", "taschengeld von eltern", "unterstützung von familie"], "in"],
    ["gifts", ["geschenk", "geburtstagsgeschenk", "weihnachtsgeschenk", "hochzeitsgeschenk"], "both"],
    ["other-income", ["mieteinnahme", "mieteinnahmen"], "in"],
    ["hobbies", ["rückzahlung buchkauf", "erstattung buchkauf"], "in"],
    ["work", ["büromaterial", "bürobedarf", "arbeitsmittel", "hosting beruflich"], "out"],
    ["subscriptions", ["film abo", "mail abo", "streaming abo"], "both"],
    ["other", ["bestattung", "bestattungshaus", "bestattungskosten", "beerdigungskosten"], "out"],
    ["friends", ["anteil gemeinsames abendessen", "anteil abendessen zurück"], "both"],
    ["internet-phone", ["internet festnetz", "festnetzanschluss"], "out"],
  ];
  for (const [id, phrases, direction] of blocks) for (const text of phrases) {
    for (const amount of [-19, 19]) {
      const expected = direction === "both" || direction === (amount < 0 ? "out" : "in") ? id : null;
      assert.equal(category("Beispiel Zahlungspartner", text, amount), expected, `${text} ${amount}`);
    }
    assert.equal(category(`x${text.replaceAll(" ", "")}technik`), null, text);
    assert.equal(starterCategory({ description: text, amount: direction === "in" ? 19 : -19 }, []), null, text);
  }
  for (const text of ["Eltern", "Familie", "Unterstützung", "Anteil", "Abo", "Rückzahlung", "Einnahme", "beruflich"]) {
    assert.equal(category("Beispiel Person", text, 19), null, text);
  }
  assert.equal(category("Blumen Beispiel", "Haarschnitt"), "personal-care");
  assert.equal(category("Geschenk GmbH", "Gehalt", 19), "salary");
  assert.equal(category("Beispiel Person", "Eigenübertrag Geschenk", 19), "own-transfers");
  assert.equal(category("Beispiel Person", "Geschenk für Levis Geburtstag"), "gifts");
  assert.equal(category("Beispiel Person", "Zuzahlung Geschenk Lisa"), "gifts");
  assert.equal(category("Café Beispiel", "Möbelkauf"), "household");
  assert.equal(category("Apotheke Beispiel", "Cocktails"), "going-out");
  assert.equal(category("Bäckerei Beispiel", "Einkauf frisches Brot"), "groceries");
  assert.equal(category("Bäckerei Beispiel", "Einkauf Brötchen"), "coffee-snacks");
  assert.equal(category("Brot für die Welt", "Ihr Einkauf bei Brot für die Welt"), "donations");
  assert.equal(category("Beispiel Shop", "Einkauf EREF:Brot"), null);
  assert.equal(category("Wolt", "EREF:Apotheke"), "eating-out");
  for (const delivery of ["Wolt", "Uber Eats"]) {
    assert.equal(category(`${delivery} *Apotheke Beispiel`), "health");
    assert.equal(category(`${delivery} *Apothekentechnik Beispiel`), "eating-out");
    assert.equal(category(`${delivery} *Apotheke Beispiel`, "", 19), null);
  }
  assert.equal(starterCategory({ counterparty: "Wolt *Apotheke Beispiel", amount: -19 }, [{ id: "eating-out" }]), null);
});

test("the broadcasting contribution stays with the home's running costs, apart from similarly named words", () => {
  // Claude, 2026-11-01: it is charged per home, Aresium sorted it as utilities before, and a person without Fees ticked
  // would otherwise see it unsorted (the guide accepts fees, utilities and subscriptions).
  for (const word of ["ARD ZDF", "Beitragsservice"]) {
    for (const amount of [-19, 19]) assert.equal(category(word, "", amount), "utilities");
    assert.equal(category(word.replaceAll(" ", "") + "technik"), null);
  }
  assert.equal(category("Beispiel Rundfunk", "Rundfunkbeitrag"), "utilities");
  assert.equal(category("Rundfunk ARD, ZDF, DRadio", "Rundfunkbeitrag 4567"), "utilities");
  assert.equal(category("Rundfunkbeitragstechnik"), null);
  assert.equal(category("Stadtwerke Beispiel", "Stromabschlag"), "utilities");
});

test("additional descriptive shop types use whole words and apply only to spending", () => {
  for (const [id, words] of [
    ["drugstore", ["naturdrogerie"]], ["car-fuel", ["gastankstelle", "tanke", "kfz meisterbetrieb"]],
    ["travel", ["apartmenthotel", "familienferienstätte"]], ["health", ["ärztehaus", "zahnärzte"]],
    ["sports-fitness", ["sporthalle", "sportplatz", "schulsportplatz", "tennisclub"]],
    ["personal-care", ["friseure", "friseurinnen", "hair design", "hairstyle"]],
    ["clothes", ["strumpfmoden", "schmuck", "uhren"]],
  ] as [string, string[]][]) for (const word of words) {
    assert.equal(category(`SQ *${word} Beispiel`), id, word);
    assert.equal(category(`SQ *${word} Beispiel`, "", 19), null, word);
    assert.equal(category(`x${word.replaceAll(" ", "")}service`), null, word);
  }
});

test("reviewed NSI names stay whole merchants when they are also ordinary words or surnames", () => {
  for (const name of ["stradivarius", "ecco", "barbour", "o'neill", "mephisto", "parfois", "reno", "outfit", "street shoes",
    "r.m.williams", "red wing", "we fashion", "hermès", "bvlgari", "bulgari"]) {
    assert.equal(category(`SQ *${name}`), "clothes", name);
    assert.equal(category(`SQ *${name}`, "", 19), "clothes", name);
    assert.equal(category(`x${name.replace(/[^a-z]/giu, "")}technik`), null, name);
  }
  for (const name of ["bahlsen", "eilles", "lindt", "läderach", "neuhaus", "storck"]) {
    assert.equal(category(`SQ *${name}`), "coffee-snacks", name);
    assert.equal(category(`${name} Beratungsservice`), null, name);
  }
  assert.equal(category("SØSTRENE GRENE"), "household");
  assert.equal(category("XSØSTRENEGRENETECHNIK"), null);
  for (const name of ["m&s outlet", "marks & spencer outlet"]) {
    assert.equal(category(`SQ *${name}`), "clothes");
    assert.equal(category(name.replaceAll(" ", "") + "service"), null);
  }
});

test("new NSI retail types retain geography, personal-name and whole-word filters", () => {
  const item = (name: string, include = ["de"]) => ({ displayName: name, locationSet: { include }, tags: { name } });
  const nsi = { _meta: { version: NSI.version }, nsi: {
    "brands/shop/jewelry": { items: [item("Beispiel Jewellery"), item("Christ"), item("Fern Jewellery", ["fr"])] },
    "brands/shop/watches": { items: [item("Beispiel Watches"), item("Tudor")] },
    "brands/shop/confectionery": { items: [item("Beispiel Sweets"), item("Neuhaus")] },
    "brands/shop/chocolate": { items: [item("Beispiel Chocolate")] },
    "brands/shop/mall": { items: [item("Beispiel Mall")] },
  } };
  const { list, conflicts } = buildShopList(nsi);
  assert.deepEqual(conflicts, []);
  const names = list.brands.flatMap(([, words]) => words);
  for (const name of ["christ", "tudor", "neuhaus", "fern jewellery"]) assert.ok(!names.includes(name), name);
  for (const [name, id] of [["Beispiel Jewellery", "clothes"], ["Beispiel Watches", "clothes"],
    ["Beispiel Sweets", "coffee-snacks"], ["Beispiel Chocolate", "coffee-snacks"], ["Beispiel Mall", "shopping"]]) {
    assert.ok(list.brands.find(([categoryId]) => categoryId === id)?.[1].includes(name.toLowerCase()), name);
  }
});

test("every imported brand, including the new retail types, rejects being part of an unrelated word", () => {
  for (const rule of STARTER_RULES.filter((rule) => rule.source === "brand")) {
    const unrelated = `X${rule.pattern.replace(/[^\p{L}\p{N}]/gu, "")}technik`;
    assert.equal(category(unrelated), null, rule.pattern);
  }
});
