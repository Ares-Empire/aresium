import assert from "node:assert/strict";
import { test } from "node:test";
import { buildShopList, NSI, refreshShopRules, type ShopList } from "../../scripts/build-shop-list.js";
import { DENY, MARKETPLACES, MERCHANTS, NO_BRANCHES, PLAIN_VOWEL_WORDS, RULES, SHORT_BRANDS } from "../../scripts/shop-list.de.js";
import { BUILT_IN_CATEGORIES, DEFAULT_CATEGORIES, sortPayments, STARTER_RULES, starterCategory } from "./index.js";
import { compileShopList } from "./sorting/shop-matcher.js";
import { compactLength, shopSpellings, shopWords } from "./sorting/shop-words.js";
import { findShop } from "./sorting/starter-rules.js";
import shopFile from "./sorting/shops.de.json" with { type: "json" };

// Every text below is made up in the formats German banks print (no real payments).
const all = [...DEFAULT_CATEGORIES, ...BUILT_IN_CATEGORIES];
const list = shopFile as unknown as ShopList;
const sortText = (counterparty: string, description = "") => starterCategory({ counterparty, description }, all);
// Negative amount = money out.
const sortMoney = (amount: number, counterparty: string, description = "") =>
  starterCategory({ counterparty, description, amount }, all);

test("the shop list file is the generator's output: pinned NSI version, licence, hand-written rules in order", () => {
  assert.equal(list.nsi.version, NSI.version);
  assert.equal(list.nsi.url, NSI.url);
  assert.equal(list.nsi.licence, "BSD-3-Clause");
  assert.deepEqual(list.nsi.licenceText, NSI.licenceText);
  assert.match(list.about, /name-suggestion-index/);
  // Edit scripts/shop-list.de.ts, then `npm run shops`: the JSON must not lag behind the hand-written source.
  assert.deepEqual(list.rules, RULES.map(([id, names, direction]) => [id, [...names], direction]));
  assert.deepEqual([...list.merchants].sort(), MERCHANTS.map(([id, names, direction]) => [id, [...names], direction]).sort());
  assert.deepEqual(list.noBranches, NO_BRANCHES);
  assert.deepEqual(list.plainVowelWords, PLAIN_VOWEL_WORDS);
  const ids = new Set(all.map((c) => c.id));
  for (const part of [list.rules, list.merchants, list.brands]) for (const entry of part) {
    // Hand-written blocks say which way the money moves; brands count both ways.
    assert.equal(entry.length, part === list.brands ? 2 : 3);
    if (part !== list.brands) assert.ok(["out", "in", "both"].includes(entry[2] as string), `${entry[0]}: ${entry[2]}`);
    assert.ok(ids.has(entry[0]), entry[0]);
    assert.ok(entry[1].length > 0 && entry[1].every((name) => typeof name === "string" && name.trim() === name), entry[0]);
  }
  const merchants = new Set(MERCHANTS.flatMap(([, names]) => names));
  for (const name of NO_BRANCHES) assert.ok(merchants.has(name), name);
});

test("offline regeneration refreshes hand-written rules and preserves the pinned brands and metadata", () => {
  const stale = { ...list, rules: [], merchants: [], noBranches: [], plainVowelWords: [] };
  const original = JSON.stringify(stale);
  const refreshed = refreshShopRules(stale);
  assert.deepEqual(refreshed, list);
  assert.equal(JSON.stringify(stale), original);
  assert.equal(refreshed.brands, list.brands);
  assert.equal(refreshed.nsi, list.nsi);
  assert.throws(() => refreshShopRules(null), /pinned NSI version/);
  assert.throws(() => refreshShopRules({ ...stale, nsi: { ...stale.nsi, version: "old" } }), /pinned NSI version/);
  assert.throws(() => refreshShopRules({ ...stale, nsi: { ...stale.nsi, sha256: "wrong" } }), /pinned NSI version/);
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

test("texts that must not match: people, words, prices, marketplaces and payment services, either way the money moves", () => {
  for (const [counterparty, description] of [
    ["Max Müller", "Geburtstag"], ["Anna Kaiser", "Danke"], ["Penny Schmidt", ""], ["Norma Becker", ""], ["Jonas Spar", ""],
    ["", "Penny Lane 3"], ["Lisa Becker", "Total 23,50"], ["", "Total 23,50"], ["", "Action required"],
    ["Real Estate Beispiel GmbH", ""], ["Hit Radio Beispiel", ""], ["Star Beispiel", ""], ["Jet Beispiel", ""],
    ["MUELLER 1234", "Kartenzahlung"], ["Spar- und Darlehnskasse Beispiel", ""], ["Volksbank Raiffeisenbank Beispiel", ""],
    ["PayPal Europe S.a.r.l. et Cie, S.C.A.", "PP.1234.PP"], ["AMZN Mktp DE", ""], ["Amazon EU S.a r.l.", ""],
    ["eBay GmbH", ""], ["Klarna Bank AB", ""], ["SumUp", ""], ["Zettle by PayPal", ""],
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
  ] as const) {
    assert.equal(sortText(counterparty, description), null, `${counterparty} | ${description}`);
    for (const amount of [-23.5, 23.5]) assert.equal(sortMoney(amount, counterparty, description), null, `${amount} ${counterparty} | ${description}`);
  }
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

// ── The direction of the money (brief 17) ─────────────────────────────────────────────────────────────────────────
// [counterparty, description, category on money out, category on money in]
const directions: [string, string, string | null, string | null][] = [
  // Spending words: only money out. Money in with them is a parent, flatmate or friend paying, or a refund.
  ["Hausverwaltung Beispiel GmbH", "Miete 11/2026", "rent", null],
  ["Maria Beispiel", "Miete und Unterhalt November", "rent", null],
  ["Lukas Beispiel", "Anteil Miete Oktober WG", "rent", null],
  ["Max Beispiel", "Kaltmiete November", "rent", null],
  ["Hausverwaltung Beispiel", "Nebenkostenabrechnung 2025 Guthaben", "rent", null],
  ["Lukas Beispiel", "Nebenkosten Anteil Oktober", "utilities", null],
  ["Stadtwerke Beispielstadt GmbH", "Abschlag Strom 11/2026", "utilities", null],
  ["", "Kontoführungsentgelt 10/2026", "fees", null],
  ["Lisa Beispiel", "Pizza gestern", "eating-out", null],
  ["Lisa Beispiel", "Taxi vom Flughafen", "taxi-sharing", null],
  ["Restaurant Olivo", "Abrechnung Oktober", "eating-out", null],
  ["Technische Universität Beispielstadt", "Semesterbeitrag WS 2026/27", "education", null],
  ["Apotheke am Markt", "", "health", null],
  ["Lisa Beispiel", "Spende Sommerfest", "donations", null],
  ["Finanzamt Beispielstadt", "Einkommensteuer 2025", "taxes", "taxes"],
  ["Lisa Beispiel", "Einkommensteuer 2025", "taxes", null],
  ["Staatsoberkasse Beispiel", "Steuererstattung 2025", null, "taxes"],
  // Income words: only money in. Money out with them is paying someone.
  ["Beispiel GmbH", "Gehalt Oktober 2026", null, "salary"],
  ["Anna Beispiel", "Gehalt Babysitting Oktober", null, "salary"],
  ["Tom Beispiel", "Lohn Umzugshilfe", null, "salary"],
  ["Beispiel Verlag GmbH", "Honorar Artikel 10/2026", null, "salary"],
  ["Dr. Beispiel Steuerberatung", "Honorar Steuererklärung 2025", "taxes", "salary"],
  ["Landesamt für Finanzen", "Bezüge 10/2026", null, "salary"],
  ["Bundeskasse", "BAföG 10/2026", null, "bafoeg-scholarships"],
  ["Bundesverwaltungsamt", "BAföG Darlehen Rückzahlung", null, "bafoeg-scholarships"],
  ["Familienkasse Bayern Süd", "Kindergeld", null, "kindergeld"],
  ["Maria Beispiel", "Kindergeld Oktober", null, "kindergeld"],
  ["", "Zinsgutschrift", null, "interest-dividends"],
  ["momox GmbH", "Ankauf 1234", null, "selling-things"],
  // Transfer words: both ways.
  ["", "Umbuchung", "own-transfers", "own-transfers"],
  ["Trade Republic Bank GmbH", "Sparplan", "savings-investing", "savings-investing"],
  // Shop and brand names: both ways, money in is a refund.
  ["Zalando SE", "Retoure 1234", "clothes", "clothes"],
  ["REWE Markt GmbH", "Erstattung", "groceries", "groceries"],
  ["Deutsche Lufthansa AG", "Erstattung Flug", "travel", "travel"],
  ["Vonovia SE", "Kaution", "rent", "rent"],
  ["Decathlon Deutschland SE & Co. KG", "Retoure", "sports-fitness", "sports-fitness"],
  ["Deichmann-Schuhe 123", "", "clothes", "clothes"], // "schuhe" only on money out, the brand both ways
  // A chain the list knows only through a generic word counts only on money out, like the word.
  ["Pizza Hut Beispiel", "", "eating-out", null],
  ["NETFLIX.COM", "", "subscriptions", "subscriptions"],
  // Platforms that pay people: only money out, their money in is a payout.
  ["Wolt", "Bestellung 1234", "eating-out", null],
  ["Wolt Enterprises Deutschland GmbH", "Auszahlung Kurier 10/2026", "eating-out", null],
  ["Lieferando.de", "Bestellung 1234", "eating-out", null],
  ["Deliveroo", "", "eating-out", null],
  ["Uber Eats", "", "eating-out", null],
  ["UBER *TRIP HELP.UBER.COM", "", "taxi-sharing", null],
  ["Uber BV", "Payout", "taxi-sharing", null],
  ["UBER", "", "taxi-sharing", null],
  ["Bolt Operations", "", "taxi-sharing", null],
  ["FREENOW", "", "taxi-sharing", null],
  ["BlaBlaCar", "Fahrt Beispielstadt", "taxi-sharing", null],
  ["Flink SE", "", "groceries", null],
  ["Airbnb Payments", "", "travel", null],
  ["viagogo AG", "", "entertainment", null],
  ["GoFundMe", "", "donations", null],
  ["momox fashion", "", "clothes", null],
  ["Studierendenwerk Beispielstadt", "Abrechnung 10/2026", "eating-out", null],
  // Marketplaces never count, either way.
  ["Etsy Ireland UC", "", null, null], ["eBay GmbH", "", null, null],
];
test("spending words count only on money out, income words only on money in, transfer words both ways", () => {
  for (const [counterparty, description, out, into] of directions) {
    assert.equal(sortMoney(-42.5, counterparty, description), out, `out: ${counterparty} | ${description}`);
    assert.equal(sortMoney(42.5, counterparty, description), into, `in: ${counterparty} | ${description}`);
  }
});

test("every hand-written name counts in its own direction and gives nothing in the other", () => {
  for (const rule of STARTER_RULES) for (const amount of [-12.5, 12.5]) {
    const counts = rule.direction === "both" || rule.direction === (amount < 0 ? "out" : "in");
    assert.equal(starterCategory({ counterparty: rule.pattern, amount }, all), counts ? rule.categoryId : null,
      `${rule.pattern} (${rule.direction}) ${amount}`);
  }
  // NSI brands are shop names: both ways.
  assert.ok(STARTER_RULES.filter((rule) => rule.source === "brand").every((rule) => rule.direction === "both"));
});

test("without an amount, or with 0, the direction is unknown and every rule counts", () => {
  assert.equal(sortText("Maria Beispiel", "Miete und Unterhalt November"), "rent");
  assert.equal(sortMoney(0, "Maria Beispiel", "Miete und Unterhalt November"), "rent");
  assert.equal(sortMoney(Number.NaN, "Beispiel GmbH", "Gehalt Oktober 2026"), "salary");
  assert.equal(sortText("Wolt"), "eating-out");
});

test("sortPayments passes each payment's amount to the shop list", () => {
  const payments = [
    { counterparty: "Maria Beispiel", description: "Miete und Unterhalt November", amount: 650 },
    { counterparty: "Hausverwaltung Beispiel GmbH", description: "Miete 11/2026", amount: -650 },
    { counterparty: "Wolt Enterprises Deutschland GmbH", description: "Auszahlung Kurier 10/2026", amount: 412.3 },
  ];
  assert.deepEqual(sortPayments(payments, { categories: all }).map((r) => r.categoryId), [null, "rent", null]);
});

test("a longer name for the other direction still hides the shorter names inside it", () => {
  const m = compileShopList({
    rules: [["own", ["umbuchung"], "both"], ["travel", ["umbuchung flug"], "out"], ["airline", ["lufthansa"], "both"],
      ["food", ["uber eats"], "out"], ["rent", ["miete"], "out"], ["salary", ["gehalt"], "in"]],
    merchants: [["taxi", ["uber"], "out"], ["shop", ["penny"]]],
    brands: [["brand", ["eats"]]],
  });
  const at = (amount: number, counterparty: string, description?: string) => m.match({ counterparty, description, amount });
  assert.equal(at(-1, "Lufthansa", "Umbuchung Flug"), "travel");
  assert.equal(at(1, "Lufthansa", "Umbuchung Flug"), "airline"); // not "umbuchung" inside it
  assert.equal(at(1, "Anna Beispiel", "Umbuchung"), "own");
  assert.equal(at(-1, "Uber Eats"), "food");
  assert.equal(at(1, "Uber Eats"), null); // not "eats" (a brand) and not "uber" (a merchant)
  assert.equal(at(1, "Uber"), null); // a merchant for money out decides on money in too: nothing
  assert.equal(at(1, "Penny"), "shop"); // no direction given: both ways
  assert.equal(at(1, "Anna Beispiel", "Miete"), null);
  assert.equal(at(-1, "Anna Beispiel", "Miete Gehalt"), "rent");
  assert.equal(at(1, "Anna Beispiel", "Miete Gehalt"), "salary");
  // The real list: on money in, "Umbuchung Flug" is not an own transfer, so the airline decides.
  assert.equal(sortMoney(180, "Deutsche Lufthansa AG", "Umbuchung Flug LH 1234 Erstattung"), "travel");
  assert.equal(sortMoney(180, "Lisa Beispiel", "Umbuchung Flug"), null);
  assert.equal(sortMoney(180, "", "Umbuchung"), "own-transfers");
});

// ── Branch numbers (brief 17) ─────────────────────────────────────────────────────────────────────────────────────
test("a chain that counts only as the whole name also counts at the start, followed by a branch number", () => {
  for (const [counterparty, description, categoryId] of [
    ["PENNY 4211 GARCHING", "Kartenzahlung girocard 2026-10-20T12:34", "groceries"],
    ["PENNY 4211>GARCHING", "", "groceries"],
    ["NETTO 1234 Dachau", "", "groceries"],
    ["NETTO 1234 DACHAU//DACHAU/DE", "", "groceries"],
    ["NORMA 123", "", "groceries"], ["NORMA 12 Garching", "", "groceries"], ["SPAR 5678", "", "groceries"],
    ["HIT 456 Eching", "", "groceries"], ["GLOBUS 12 Freising", "", "groceries"],
    ["", "Kartenzahlung PENNY 4211 GARCHING", "groceries"],
    ["JET 1234 Unterschleissheim", "", "car-fuel"], ["TOTAL 123456 Ismaning", "", "car-fuel"],
    ["BAUHAUS 123 Garching", "", "household"], ["NORDSEE 12 Freising", "", "eating-out"],
    ["DOUGLAS 1234 Erding", "", "personal-care"], ["THALIA 99 Landshut", "", "hobbies"],
  ] as const) {
    for (const amount of [-18.4, 18.4]) assert.equal(sortMoney(amount, counterparty, description), categoryId, `${amount} ${counterparty} | ${description}`);
    assert.equal(sortText(counterparty, description), categoryId, `${counterparty} | ${description}`);
  }
  for (const [counterparty, description] of [
    ["", "Penny Lane 3"], ["Penny Lane 3", ""], ["Max Müller 12", ""], ["MUELLER 1234 GARCHING", ""], ["Penny Schmidt 12", ""],
    ["Anna Beispiel", "PENNY 4211 GARCHING"], // who was paid is the counterparty: a person
    ["PENNY 1234567 GARCHING", ""], ["PENNY 4211A GARCHING", ""], ["PENNY4211 GARCHING", ""], ["PENNY 4 GARCHING", ""],
    ["", "Total 23,50"], ["", "Total 23.50 EUR"], ["", "Norma 12:30 Treffen"], ["1234 PENNY GARCHING", ""],
    ["CAMBIO 123 MADRID", ""], ["UBER 1234 AMSTERDAM", ""], ["FLINK 24 SCHLUESSELDIENST", ""],
  ] as const) {
    for (const amount of [-18.4, 18.4]) assert.equal(sortMoney(amount, counterparty, description), null, `${amount} ${counterparty} | ${description}`);
  }
  // Each in its direction: Uber is still Uber when the text says so.
  assert.equal(sortMoney(-9.9, "UBER *TRIP 1234"), "taxi-sharing");
});

test("branch numbers in the matcher: only whole-merchant names, only first, 2 to 6 digits standing alone", () => {
  const m = compileShopList({ rules: [], merchants: [["shop", ["penny", "die beispielkette"], "both"],
    ["car", ["cambio"], "both"]], noBranches: ["cambio"], brands: [["brand", ["lane"]]] });
  const at = (counterparty: string, description?: string) => m.match({ counterparty, description, amount: -5 });
  assert.equal(at("PENNY 4211 GARCHING"), "shop");
  assert.equal(at("Die Beispielkette 77 Freising"), "shop");
  assert.equal(at("Penny Lane 3"), "brand"); // a word between: the brand "lane", not the merchant
  assert.equal(at("CAMBIO 123 MADRID"), null);
  assert.equal(at("Cambio"), "car");
});

test("a hand-list merchant matches before its own card-line town or a known city", () => {
  const card = (shop: string, town = "Musterstadt") =>
    `${shop}          DEU ${town}            EUR   9,47 Umsatz vom 08.10.2026 MC Hauptkarte`;
  for (const shop of ["Penny", "Norma", "Netto"]) {
    assert.equal(sortMoney(-9.47, "", card(`${shop} Musterstadt`)), "groceries", shop);
    assert.equal(sortMoney(-9.47, `${shop} Musterstadt`, card(`${shop} Musterstadt`)), "groceries", shop);
    assert.equal(sortText(`${shop} Berlin`), "groceries", shop);
    assert.equal(sortText("", `${shop} München`), "groceries", shop);
    assert.equal(sortText(`${shop} Musterstadt`), null, shop); // no proof of the unknown town
    assert.equal(sortText("", card(`${shop} Musterstadt`, "Anderstadt")), null, shop);
  }
  assert.equal(sortText("", card("Penny")), "groceries");
  assert.equal(sortText("", card("Penny 42 Musterstadt")), "groceries");
  assert.equal(sortText("", card("Rossmann Fil. 123")), "drugstore");
  assert.equal(sortText("", card("Mueller Drogerie-Markt")), "drugstore");
  assert.equal(sortText("Fremder Beispiel", card("Penny Musterstadt")), null);
  assert.equal(sortText("", card("Penny Beispiel Musterstadt")), null); // exactly one extra word
  assert.equal(sortText("", card("Penny Beispielstadt", "Berlin")), null);
});

test("town matching never turns Penny's longer names into the supermarket", () => {
  const m = compileShopList({ rules: [], merchants: [["groceries", ["penny"]]], brands: [] });
  for (const name of ["Penny Reisen", "Penny Mobil", "Pennyblack"]) {
    assert.equal(m.match({ counterparty: name }), null, name);
    assert.equal(m.match({ description: `${name}          DEU Musterstadt            EUR 9,47 Umsatz vom 08.10.2026 MC Hauptkarte` }), null, name);
  }
  assert.equal(sortMoney(-9.47, "Penny Reisen"), "travel");
  assert.equal(sortMoney(-9.47, "Penny Mobil"), "internet-phone");
  assert.notEqual(sortMoney(-9.47, "Pennyblack"), "groceries");
});

test("starterCategory and findShop accept optional town context and keep their standalone behaviour", () => {
  const payment = { counterparty: "Penny Musterstadt", amount: -5 };
  assert.equal(starterCategory(payment, all), null);
  assert.equal(findShop(payment), null);
  assert.equal(starterCategory(payment, all, ["MUSTERSTADT"]), "groceries");
  assert.equal(findShop(payment, ["Musterstadt"])?.name, "penny");
  assert.equal(findShop(payment, ["Anderstadt"]), null);
  assert.equal(starterCategory(payment, [], ["Musterstadt"]), null);
  const matcher = compileShopList({ rules: [], merchants: [["shop", ["die beispielkette"]], ["service", ["flink"], "out"]], brands: [] });
  assert.equal(matcher.match({ counterparty: "Die Beispielkette Musterstadt" }, ["Musterstadt"]), "shop");
  assert.equal(matcher.match({ counterparty: "Die Beispielkette Musterstadt Extra" }, ["Musterstadt"]), null);
  assert.equal(matcher.match({ counterparty: "Flink Musterstadt", amount: 5 }, ["Musterstadt"]), null);
  assert.equal(matcher.match({ counterparty: "Flink Musterstadt", amount: -5 }, ["Musterstadt"]), "service");
});

test("Vinted and Kleiderkreisel purchases are clothes, while sales stay unsorted", () => {
  for (const name of ["MGP Vinted - Kleiderkreisel", "Vinted, UAB", "Vinted", "Kleiderkreisel"]) {
    assert.equal(sortMoney(-24.5, name), "clothes", name);
    assert.equal(sortMoney(24.5, name), null, name);
    assert.deepEqual(sortPayments([{ source: "paypal", counterparty: name, amount: 24.5 }], { categories: all }),
      [{ categoryId: null, source: null }]);
    assert.equal(starterCategory({ counterparty: name, amount: -24.5 }, []), null);
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
