import assert from "node:assert/strict";
import { test } from "node:test";
import { buildShopList, NSI, type ShopList } from "../../scripts/build-shop-list.js";
import { DENY, MARKETPLACES, MERCHANTS, PLAIN_VOWEL_WORDS, RULES, SHORT_BRANDS } from "../../scripts/shop-list.de.js";
import { BUILT_IN_CATEGORIES, DEFAULT_CATEGORIES, sortPayments, STARTER_RULES, starterCategory } from "./index.js";
import { compileShopList } from "./sorting/shop-matcher.js";
import { compactLength, shopSpellings, shopWords } from "./sorting/shop-words.js";
import shopFile from "./sorting/shops.de.json" with { type: "json" };

// Every text below is made up in the formats German banks print (no real payments).
const all = [...DEFAULT_CATEGORIES, ...BUILT_IN_CATEGORIES];
const list = shopFile as unknown as ShopList;
const sortText = (counterparty: string, description = "") => starterCategory({ counterparty, description }, all);

test("the shop list file is the generator's output: pinned NSI version, licence, hand-written rules in order", () => {
  assert.equal(list.nsi.version, NSI.version);
  assert.equal(list.nsi.url, NSI.url);
  assert.equal(list.nsi.licence, "BSD-3-Clause");
  assert.deepEqual(list.nsi.licenceText, NSI.licenceText);
  assert.match(list.about, /name-suggestion-index/);
  // Edit scripts/shop-list.de.ts, then `npm run shops`: the JSON must not lag behind the hand-written source.
  assert.deepEqual(list.rules, RULES.map(([id, names]) => [id, [...names]]));
  assert.deepEqual([...list.merchants].sort(), MERCHANTS.map(([id, names]) => [id, [...names]]).sort());
  assert.deepEqual(list.plainVowelWords, PLAIN_VOWEL_WORDS);
  const ids = new Set(all.map((c) => c.id));
  for (const part of [list.rules, list.merchants, list.brands]) for (const entry of part) {
    assert.equal(entry.length, 2);
    assert.ok(ids.has(entry[0]), entry[0]);
    assert.ok(entry[1].length > 0 && entry[1].every((name) => typeof name === "string" && name.trim() === name), entry[0]);
  }
});

test("no pattern is three letters or shorter unless it is on the short-brand list", () => {
  const short = new Set(SHORT_BRANDS.map((name) => shopWords(name).join(" ")));
  for (const rule of STARTER_RULES) {
    if (compactLength(rule.pattern) <= 3) assert.ok(short.has(shopWords(rule.pattern).join(" ")), rule.pattern);
    assert.ok(compactLength(rule.pattern) >= 2, rule.pattern);
  }
});

test("no NSI brand is on the deny list, names a marketplace, or repeats a hand-written spelling", () => {
  const key = (name: string) => shopWords(name).join(" ");
  const deny = new Set(DENY.map(key)), marketplaces = new Set(MARKETPLACES.map(key));
  const other = new Set(list.plainVowelWords);
  const handWritten = new Set([...RULES, ...MERCHANTS].flatMap(([, names]) => names.flatMap((n) => shopSpellings(n, other))));
  for (const [, names] of list.brands) for (const name of names) {
    assert.ok(!deny.has(key(name)), name);
    assert.ok(!shopWords(name).some((w) => marketplaces.has(w)), name);
    assert.ok(!shopSpellings(name, other).some((s) => handWritten.has(s)), name);
  }
  // A spelling belongs to one category only.
  const owner = new Map<string, string>();
  for (const rule of STARTER_RULES) for (const spelling of shopSpellings(rule.pattern, other)) {
    const before = owner.get(spelling);
    assert.ok(before === undefined || before === rule.categoryId, `${rule.pattern}: ${before} and ${rule.categoryId}`);
    owner.set(spelling, rule.categoryId);
  }
});

// Several texts per category, as banks print them: legal forms, branch numbers, "SAGT DANKE", card-payment lines.
const matches: Record<string, [string, string?][]> = {
  groceries: [["REWE Markt GmbH-Zw 1234"], ["LIDL DIENSTL GMBH SAGT DANKE"], ["ALDI SE & Co. KG", "ALDI SUED 47//GARCHING/DE"],
    ["Netto Marken-Discount Stiftung & Co. KG", "NETTO FIL. 4711"], ["PENNY.Markt GmbH", "Kartenzahlung"], ["PENNY 4211 MUENCHEN"],
    ["PENNY SAGT DANKE 4211"], ["Kaufland Dienstleistung GmbH & Co. KG"], ["EDEKA M-ZENTRALE"], ["GO ASIA BERLIN"],
    ["V-MARKT 123 MUENCHEN"], ["trinkgut 0815"], ["NORMA 1234"], ["GLOBUS SB-WARENHAUS"], ["SPAR"], ["HIT Ullrich"],
    ["NETTO 1234 MUENCHEN"], ["Netto Marken-Discount Stiftung & Co. KG"]],
  drugstore: [["dm-drogerie markt GmbH + Co. KG", "DM FIL.2345 H:65"], ["Dirk Rossmann GmbH"], ["Mueller Handels GmbH & Co. KG"],
    ["", "Kartenzahlung MÜLLER DROGERIE 123"], ["MULLER DROGERIE"], ["BUDNIKOWSKY 77 HAMBURG"], ["dm 1234 München"]],
  "eating-out": [["McDonalds 1234"], ["BURGER KING 12345 MUENCHEN"], ["Lieferando.de", "Bestellung 1234"],
    ["Hans im Glück Burgergrill"], ["Vapiano SE"], ["SumUp *Restaurant Olivo"], ["SCHWEINSKE 12 HAMBURG"],
    ["TACO BELL BERLIN"], ["Peter Pane GmbH"], ["Uber Eats"], ["DONER KEBAB BEISPIEL"], ["Doener Haus"], ["NORDSEE GmbH"]],
  "coffee-snacks": [["BACKWERK 1234"], ["Kamps GmbH"], ["Bäckerei Ihle GmbH"], ["STARBUCKS COFFEE 123"],
    ["Le Crobag GmbH & Co. KG"], ["Hofpfisterei 12"], ["Coffee Fellows GmbH"], ["CAFE EXTRABLATT"], ["Rischart"]],
  rent: [["Hausverwaltung Beispiel GmbH", "Miete 11/2026"], ["Vonovia SE", "Wohnung 1234"], ["Max Beispiel", "Kaltmiete November"],
    ["Studierendenwerk Beispielstadt", "Wohnheim Miete 11/2026"], ["Anna Kaiser", "Miete Penny Lane 3"]],
  utilities: [["Stadtwerke Beispielstadt GmbH", "Abschlag Strom 11/2026"], ["E.ON Energie Deutschland GmbH"],
    ["Rundfunk ARD, ZDF, DRadio", "Rundfunkbeitrag 4567"], ["Vattenfall Europe Sales GmbH"], ["LichtBlick SE"],
    ["MVV Energie AG", "Abschlag"], ["Techem Energy Services GmbH", "Heizkostenabrechnung"]],
  "internet-phone": [["Telefonica Germany GmbH & Co. OHG", "O2 Rechnung"], ["Vodafone GmbH"], ["Telekom Deutschland GmbH"],
    ["1&1 Telecom GmbH"], ["congstar GmbH"], ["Lidl Connect", "Aufladung"], ["ALDI TALK", "Guthaben"],
    ["Deutsche Glasfaser Holding GmbH"]],
  household: [["IKEA Deutschland GmbH & Co. KG"], ["OBI GmbH & Co. Deutschland KG"], ["Hornbach Baumarkt AG"],
    ["BAUHAUS 123 MUENCHEN"], ["Bauhaus Fachcentrum"], ["Dehner GmbH"], ["Zara Home"], ["XXXLutz"], ["HOEFFNER"],
    ["Hoffner Möbelgesellschaft"]],
  pets: [["Fressnapf Tiernahrungs GmbH"], ["Das Futterhaus"], ["Zoo & Co. Beispiel"], ["Tierarztpraxis Dr. Beispiel"], ["zooplus SE"]],
  "bus-train": [["DB Vertrieb GmbH", "Fahrschein 123456"], ["MVG Automat"], ["Berliner Verkehrsbetriebe (BVG)"],
    ["Hamburger Hochbahn AG"], ["FlixBus DACH GmbH"], ["Rheinbahn AG", "Abo"], ["Kölner Verkehrs-Betriebe AG"],
    ["Karlsruher Verkehrsverbund"], ["", "Deutschlandticket November"], ["Würzburger Straßenbahn GmbH"]],
  "car-fuel": [["ARAL STATION 1234"], ["Shell Deutschland GmbH"], ["JET 1234 MUENCHEN"], ["JET Tankstelle"],
    ["ESSO STATION 4711"], ["A.T.U Auto-Teile-Unger"], ["Parkhaus Beispiel"], ["EasyPark GmbH"], ["IONITY GmbH"],
    ["Kaufland Tankstelle 12"]],
  "taxi-sharing": [["UBER *TRIP HELP.UBER.COM"], ["FREENOW"], ["SHARE NOW GmbH"], ["Bolt Operations"], ["TIER Mobility SE"],
    ["stadtmobil carsharing AG"], ["nextbike GmbH"], ["Lime Bike"]],
  travel: [["Booking.com BV"], ["Airbnb Payments"], ["Ryanair DAC"], ["Deutsche Lufthansa AG"],
    ["Sixt GmbH & Co Autovermietung KG"], ["Motel One GmbH"], ["Hotel Beispielhof"], ["Europcar Autovermietung GmbH"], ["AVIS"],
    ["Wizz Air Hungary"], ["ibis budget"]],
  health: [["Apotheke am Markt"], ["Fielmann AG"], ["Dr. med. Anna Beispiel", "Rechnung 123"], ["Zahnarztpraxis Beispiel"],
    ["DocMorris N.V."], ["Physiotherapie Beispiel"], ["Apollo-Optik"]],
  "sports-fitness": [["FitX Deutschland GmbH"], ["McFit GmbH"], ["Urban Sports GmbH"], ["Boulderwelt München Ost"],
    ["Decathlon Deutschland SE & Co. KG"], ["EGYM Wellpass"], ["Clever fit Beispiel"]],
  "personal-care": [["Friseur Beispiel"], ["Klier Hair Group"], ["Douglas GmbH"], ["Nagelstudio Beispiel"], ["Barbershop Beispiel"]],
  "going-out": [["Biergarten Beispiel"], ["Irish Pub Beispiel"], ["Cocktailbar Beispiel"], ["BrewDog Berlin"]],
  entertainment: [["CinemaxX Entertainment GmbH"], ["UCI Kinowelt"], ["CTS EVENTIM AG"], ["Ticketmaster GmbH"],
    ["Deutsches Museum"], ["LEGOLAND Deutschland"]],
  hobbies: [["Thalia Bücher GmbH"], ["THALIA 123 MUENCHEN"], ["Hugendubel GmbH"], ["Musikhaus Thomann"], ["boesner GmbH"]],
  subscriptions: [["NETFLIX.COM"], ["Spotify AB"], ["APPLE.COM/BILL"], ["Disney Plus"], ["DAZN Limited"],
    ["Sky Deutschland Fernsehen GmbH"]],
  clothes: [["Zalando SE"], ["", "Kartenzahlung ZARA DEUTSCHLAND"], ["H&M Hennes & Mauritz"], ["C&A Mode GmbH"],
    ["Primark Mode Ltd. & Co. KG"], ["Deichmann-Schuhe 123"], ["Peek & Cloppenburg KG"], ["MANGO 1234 BERLIN"],
    ["New Yorker"], ["Hennes & Mauritz B.V. & Co. KG"], ["ZARA 1234 MUENCHEN"]],
  electronics: [["MediaMarkt Saturn"], ["Cyberport GmbH"], ["notebooksbilliger.de AG"], ["Apple Store Rosenstraße"],
    ["Conrad Electronic SE"], ["Samsung Electronics GmbH"]],
  shopping: [["TEDi GmbH & Co. KG"], ["Woolworth GmbH"], ["ACTION 1234 BERLIN"], ["Galeria Kaufhof"], ["Flying Tiger Copenhagen"]],
  gifts: [["Fleurop AG"], ["Smyths Toys"], ["Jochen Schweizer GmbH"]],
  education: [["Technische Universität Beispielstadt", "Semesterbeitrag WS 2026/27"], ["Volkshochschule Beispielstadt"],
    ["Fahrschule Beispiel"], ["Goethe-Institut e.V."], ["Bauhaus-Universität Weimar", "Semesterbeitrag"]],
  insurance: [["Techniker Krankenkasse"], ["Allianz Versicherungs-AG"], ["HUK-COBURG"], ["DEVK Versicherungen"], ["AOK Bayern"],
    ["ERGO Versicherung AG"], ["Shell BKK/LIFE", "Beitrag"]],
  taxes: [["Finanzamt Beispielstadt", "Einkommensteuer 2025"], ["Stadt Beispiel", "Hundesteuer 2026"],
    ["Lohnsteuerhilfe Bayern e. V."]],
  fees: [["", "Kontoführungsentgelt 10/2026"], ["", "Abschlussentgelt"], ["", "Auslandseinsatzentgelt"]],
  cash: [["", "Bargeldauszahlung GA 1234"], ["", "Geldautomat Beispielbank"]],
  memberships: [["ADAC e.V.", "Mitgliedsbeitrag"], ["ver.di", "Beitrag"], ["IG Metall"]],
  donations: [["Greenpeace e.V.", "Spende"], ["UNICEF Deutschland"], ["Ärzte ohne Grenzen e.V."], ["SOS-Kinderdorf e.V."]],
  "savings-investing": [["Trade Republic Bank GmbH", "Sparplan"], ["Scalable Capital GmbH"]],
  salary: [["Beispiel GmbH", "Gehalt Oktober 2026"], ["Landesamt für Finanzen", "Bezüge 10/2026"]],
  "bafoeg-scholarships": [["Bundeskasse", "BAföG 10/2026"], ["Studierendenwerk Beispiel", "Amt für Ausbildungsförderung"]],
  kindergeld: [["Familienkasse Bayern Süd", "Kindergeld"]],
  "own-transfers": [["", "Umbuchung"], ["PayPal Europe", "Bankgutschrift auf PayPal-Konto"]],
  "interest-dividends": [["", "Zinsgutschrift"], ["", "Ertragsausschüttung"]],
  "selling-things": [["momox GmbH", "Ankauf"]],
};
for (const [categoryId, texts] of Object.entries(matches)) test(`bank texts that must sort as ${categoryId}`, () => {
  for (const [counterparty, description] of texts) assert.equal(sortText(counterparty, description), categoryId, `${counterparty} | ${description ?? ""}`);
});

test("texts that must not match: people, words, prices, marketplaces and payment services", () => {
  for (const [counterparty, description] of [
    ["Max Müller", "Geburtstag"], ["Anna Kaiser", "Danke"], ["Penny Schmidt", ""], ["Norma Becker", ""], ["Jonas Spar", ""],
    ["", "Penny Lane 3"], ["Lisa Becker", "Total 23,50"], ["", "Total 23,50"], ["", "Action required"],
    ["Real Estate Beispiel GmbH", ""], ["Hit Radio Beispiel", ""], ["Star Beispiel", ""], ["Jet Beispiel", ""],
    ["MUELLER 1234", "Kartenzahlung"], ["Spar- und Darlehnskasse Beispiel", ""], ["Volksbank Raiffeisenbank Beispiel", ""],
    ["PayPal Europe S.a.r.l. et Cie, S.C.A.", "PP.1234.PP"], ["AMZN Mktp DE", ""], ["Amazon EU S.a r.l.", ""],
    ["eBay GmbH", ""], ["Klarna Bank AB", ""], ["SumUp", ""], ["Zettle by PayPal", ""], ["Vinted UAB", ""],
    ["Google Pay", ""], ["Visa", "Kartenzahlung"], ["Lush Beispiel", ""], ["Kaiser Beispiel", ""], ["Depot Beispiel", ""],
    ["Westfalen Beispiel", ""], ["Sky Beispiel", ""], ["Admiral", ""], ["Notdm", ""], ["Shellfish", ""], ["OpenAI", ""],
    // words that are also brands, or brands without their second word
    ["Tom Beispiel", "Danke für den Kuchen"], ["Tom Beispiel", "Fahre morgen"], ["Tom Beispiel", "going away gift"],
    ["Zara Yilmaz", "Danke"], ["Tom Beispiel", "Geld uber PayPal"], ["Tom Beispiel", "Geschenk für Levis Geburtstag"],
    ["Tom Beispiel", "Max, Mara und Gina, Laura"], ["Tom Beispiel", "Erasmus Party Ticket"],
    ["Tom Beispiel", "Nachhilfe Mathe Oktober"], ["Die Bayerische Schlösserverwaltung", "Eintritt"],
    ["Tom Beispiel", "war super 8,50"], ["Beispiel GmbH", "Avis Nr 4711"], ["Lindenbräu am Sony Center", ""],
    ["TGV 1861 e.V.", "Beitrag"], ["Poco Loco Bar", ""], ["Farmacia Dott. Rossi", ""], ["CAMBIO 123 MADRID", ""],
    ["Tom Beispiel", "Hausrat Verkauf"], ["Tom Beispiel", "Zuzahlung Geschenk Lisa"], ["GOING 12", ""],
    // reference codes are not words
    ["Beispiel GmbH", "Rechnung EREF: DB2026101234 MREF: DM00012345"], ["Beispiel GmbH", "EREF: DB-2026-1234 MREF: DM-77"],
    ["Beispiel GmbH", "USt-IdNr ATU12345678"], ["Beispiel GmbH", "Rechnung CRED: DE98ZZZ09999999999 IBAN: DE02120300000000202051"],
  ] as const) assert.equal(sortText(counterparty, description), null, `${counterparty} | ${description}`);
  // An employer's salary is salary, whatever the employer sells.
  assert.equal(sortText("Robert Bosch GmbH", "Gehalt 10/2026"), "salary");
  assert.equal(sortText("REWE Markt GmbH", "Gehalt 10/2026"), "salary");
  assert.equal(sortText("dm-drogerie markt GmbH", "Ausbildungsvergütung 10/2026"), "salary");
});

test("umlauts match in every spelling banks use", () => {
  for (const text of ["Müller Drogerie", "MUELLER DROGERIE", "MULLER DROGERIE", "müller-drogerie"]) assert.equal(sortText(text), "drugstore", text);
  for (const text of ["Döner Palast", "DOENER PALAST", "DONER PALAST"]) assert.equal(sortText(text), "eating-out", text);
  for (const text of ["Höffner", "HOEFFNER", "HOFFNER"]) assert.equal(sortText(text), "household", text);
  assert.deepEqual(shopWords("McDonald's 1234 Café"), ["mcdonalds", "1234", "cafe"]);
  assert.deepEqual(shopWords("H&M REWE1234 O2 1&1"), ["h", "&", "m", "rewe1234", "o2", "1", "&", "1"]);
  assert.deepEqual(shopSpellings("Müller & Söhne"), ["mueller & soehne", "muller & sohne"]);
});

test("matching: whole words, a longer match wins, hand-written before brands, then the more specific brand", () => {
  const m = compileShopList({
    rules: [["a", ["kaiser"]], ["b", ["uber"]], ["c", ["uber eats"]], ["d", ["miete"]]],
    merchants: [["e", ["penny", "total"]]],
    brands: [["f", ["kaiser bistro", "pizza"]], ["g", ["pizza hut", "beta gamma"]], ["h", ["alpha"]]],
  });
  const at = (counterparty: string, description?: string) => m.match({ counterparty, description });
  assert.equal(at("Rewerk Kaiserslautern"), null);
  assert.equal(at("Uber Eats"), "c");
  assert.equal(at("Uber BV"), "b");
  assert.equal(at("Kaiser Bistro"), "a"); // the hand-written rule wins over a longer brand
  assert.equal(at("Pizza Hut Beispiel"), "g");
  assert.equal(at("Pizza Beispiel"), "f");
  assert.equal(at("alpha beta gamma"), "g"); // two brands, no overlap: more words wins
  assert.equal(at("PENNY 1234 Berlin"), "e");
  assert.equal(at("Penny GmbH"), "e");
  assert.equal(at("Penny Lane 3"), null);
  assert.equal(at("", "Total 23,50"), null);
  assert.equal(at("Penny", "Miete"), "d"); // a word rule is decided before the whole merchant name
});

test("the hand-written priorities: specific names beat the shop or service they contain", () => {
  for (const [text, categoryId] of [
    ["Lidl Connect", "internet-phone"], ["Aldi Talk", "internet-phone"], ["Penny Reisen", "travel"], ["REWE Reisen", "travel"],
    ["MVV Energie AG", "utilities"], ["MVV Abo", "bus-train"], ["DB Connect GmbH", "taxi-sharing"], ["Uber Eats", "eating-out"],
    ["Zara Home", "household"], ["Kaufland e-commerce Services", "shopping"], ["ADAC Versicherung AG", "insurance"],
    ["Studierendenwerk Beispiel", "eating-out"], ["Studierendenwerk Beispiel Wohnheim", "rent"], ["IKEA Restaurant", "eating-out"],
    ["Allianz Arena München Stadion GmbH", "entertainment"], ["Uber Arena Berlin", "entertainment"],
    ["Lufthansa Umbuchung Flug", "travel"], ["Netto Getränke-Discount", "groceries"],
  ] as const) assert.equal(sortText(text), categoryId, text);
  // Rent wins over the costs a rent transfer often names; a holiday flat is travel.
  for (const [purpose, categoryId] of [["Miete + Strom Oktober WG", "rent"], ["Miete inkl. Nebenkosten", "rent"],
    ["Miete netto Oktober", "rent"], ["Ferienwohnung Nordsee", "travel"]] as const) {
    assert.equal(sortText("Anna Beispiel", purpose), categoryId, purpose);
  }
});

test("every name keeps its category when only that category is chosen, and nothing else is returned", () => {
  for (const rule of STARTER_RULES) {
    const payment = { counterparty: rule.pattern };
    assert.equal(starterCategory(payment, [{ id: rule.categoryId }]), rule.categoryId, rule.pattern);
    assert.equal(starterCategory(payment, all.filter((c) => c.id !== rule.categoryId)), null, rule.pattern);
  }
});

test("5,000 payments sort in well under a second", () => {
  const texts: [string, string][] = [["REWE Markt GmbH-Zw 1234", "Kartenzahlung girocard"], ["Max Beispiel", "Danke für gestern"],
    ["PayPal Europe S.a.r.l. et Cie, S.C.A.", "PP.1234.PP . Ihr Einkauf bei Beispielladen"], ["Stadtwerke Beispiel GmbH", "Abschlag"],
    ["Unbekannter Händler 42", "Kartenzahlung 2026-03-12T12:34 Debitk.1 2027-12"]];
  const payments = Array.from({ length: 5000 }, (_, i) => {
    const [counterparty, description] = texts[i % texts.length];
    return { counterparty: `${counterparty} ${i}`, description: `${description} EREF:${100000 + i} MREF:M-${i} CRED:DE98ZZZ09999999999` };
  });
  const start = performance.now();
  const results = sortPayments(payments, { categories: all });
  const ms = performance.now() - start;
  assert.equal(results.length, 5000);
  assert.ok(ms < 500, `${ms.toFixed(0)} ms`);
});

test("the generator: German locations only, deny list, short names, family-name trades, conflicts must be decided", () => {
  const item = (name: string, include: string[], extra: Record<string, unknown> = {}) =>
    ({ displayName: name, locationSet: { include }, tags: { name, brand: name }, ...extra });
  const nsi = (items: Record<string, unknown[]>) => ({ _meta: { version: NSI.version }, nsi: Object.fromEntries(
    Object.entries(items).map(([path, list]) => [path, { items: list }])) }) as Parameters<typeof buildShopList>[0];
  const { list: built, dropped, conflicts } = buildShopList(nsi({
    "brands/shop/supermarket": [item("Beispielmarkt Nord", ["de"]), item("Fernmarkt", ["fr"]), item("Weltmarkt Beispiel", ["001"]),
      item("Penny", ["de"]), item("Xy", ["de"]), item("Ausnahmemarkt", ["001"], { locationSet: { include: ["001"], exclude: ["de"] } }),
      item("Rewe City", ["de"])],
    "brands/shop/bakery": [item("Beispielbeck", ["de"]), item("Bäckerei Beispielbeck", ["de"])],
    "brands/shop/car_repair": [item("Beispielauto", ["001"], { fromTemplate: true })],
  }));
  const groceries = built.brands.find(([id]) => id === "groceries")?.[1];
  assert.deepEqual(groceries, ["beispielmarkt nord", "weltmarkt beispiel"]);
  assert.deepEqual(built.brands.find(([id]) => id === "coffee-snacks"), undefined); // "bäckerei" is a hand-written rule
  assert.deepEqual(dropped["deny list"], ["penny"]);
  assert.deepEqual(dropped["three characters or fewer"], ["xy"]);
  assert.deepEqual(dropped["one word in a family-name trade"], ["beispielbeck"]);
  assert.deepEqual(dropped["covered by a hand-written rule"], ["bäckerei beispielbeck", "rewe city"]);
  assert.deepEqual(conflicts, []);
  const twice = buildShopList(nsi({ "brands/shop/supermarket": [item("Zweifach Beispiel", ["de"])],
    "brands/amenity/fuel": [item("Zweifach Beispiel", ["de"])] }));
  assert.deepEqual(twice.conflicts, ["zweifach beispiel: groceries, car-fuel"]);
});
