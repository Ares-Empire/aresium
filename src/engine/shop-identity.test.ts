import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CATEGORIES, learn, merchantKey, parseVrBankCsv, readBankText, shopIdentities, sortPayments } from "./index.js";
import { cardMerchant } from "./sorting/merchant.js";

const identities = (...names: string[]) => shopIdentities(names.map((counterparty) => merchantKey({ counterparty })));

test("shop identities remove legal suffixes without changing stored merchant keys", () => {
  const forms = ["GmbH", "AG", "SE", "KG", "OHG", "e.K.", "UAB", "ApS", "Ltd", "Pte. Ltd.", "Limited", "S.A.",
    "SAS", "SARL", "S.à r.l.", "B.V.", "N.V.", "S.L.", "S.r.l.", "S.p.A.", "Sp. z o.o.", "AB", "AS", "Oy", "Inc",
    "LLC", "Corp", "plc", "Pty", "oHG", "mbH", "UG (haftungsbeschränkt)", "e.V.", "gGmbH", "KGaA", "Aktiengesellschaft",
    "GmbH & Co. KG", "GmbH und Co. KG", "Pty Ltd"];
  for (const form of forms) {
    assert.deepEqual(shopIdentities([`Fiktivladen ${form}`, "Fiktivladen"]), ["fiktivladen", "fiktivladen"], form);
    assert.deepEqual(identities(`Fiktivladen ${form}`, "Fiktivladen"), ["fiktivladen", "fiktivladen"], form);
  }
  assert.equal(merchantKey({ counterparty: "Fiktivladen UAB" }), "fiktivladen uab");
  assert.equal(merchantKey({ counterparty: "Fiktivladen ApS" }), "fiktivladen aps");
  assert.deepEqual(identities("Too Good To Go ApS", "Too Good To Go"), ["too good to go", "too good to go"]);
  assert.deepEqual(shopIdentities(["AB Fiktivladen", "Fiktivladen Labs", "Fiktivladen Corporation"]),
    ["ab fiktivladen", "fiktivladen labs", "fiktivladen corporation"]);
});

test("comparison folds umlauts, accents, sharp s, punctuation and thanks", () => {
  assert.deepEqual(shopIdentities(["Fiktivläden-Café Straße sagt danke", "Fiktivlaeden Cafe Strasse dankt"]),
    ["fiktivlaeden cafe strasse", "fiktivlaeden cafe strasse"]);
  assert.deepEqual(shopIdentities(["Fiktivladen / Nord; Süd", "Fiktivladen Nord Sued"]),
    ["fiktivladen nord sued", "fiktivladen nord sued"]);
  assert.equal(shopIdentities(["Fiktiv's Laden"])[0], "fiktiv s laden");
  assert.deepEqual(shopIdentities(["", "", "   ", "***"]), ["", "", "", ""]);
  assert.deepEqual(shopIdentities([]), []);
});

test("known shops unify chain spellings, corporate changes and the Apple billing names", () => {
  for (const [names, identity] of [
    [["MGP Vinted - Kleiderkreisel", "Vinted, UAB", "Vinted", "Kleiderkreisel"], "vinted"],
    [["dm-drogerie markt", "dm drogerie", "dm drogerie markt", "DM DROGERIEMARKT", "dm"], "dm"],
    [["apple services", "apple.com bill", "apple store", "apple distribution international", "Apple", "apple music", "apple tv"], "apple"],
    [["REWE Markt Filiale 42 München", "REWE CITY", "REWE sagt danke", "Rewe-Eck"], "rewe"],
    [["PENNY 42 GARCHING", "Penny GmbH", "Penny LLC"], "penny"],
    [["Wolt Enterprises Deutschland", "Wolt"], "wolt"],
    [["BackWerk Filiale Beispielstadt", "Backwerk"], "backwerk"],
    [["Union Investment Service", "Union Investment"], "union investment"],
    [["Bauhaus E-Business Gesellschaft für Bau- und Hausbedarf mbH", "Bauhaus E-Business Gesellschaft", "Bauhaus E-Business"],
      "bauhaus e business gesellschaft"],
  ] as const) assert.deepEqual(identities(...names), names.map(() => identity), identity);
  // Identity ignores payment direction; sorting still uses the shop list's own direction rules.
  assert.deepEqual(sortPayments([{ counterparty: "Vinted, UAB", amount: 12 }], { categories: DEFAULT_CATEGORIES }),
    [{ categoryId: null, source: null }]);
});

test("shop boundaries and generic category words do not merge unrelated shops or people", () => {
  for (const [left, right] of [
    ["Apple", "Applebee's"], ["Apple", "Appleton Werkstatt"], ["REWE", "Reweck"],
    ["Penny", "Penny Lane 3"], ["Bauhaus", "Bauhaus Architektur"], ["Café Nord", "Café Süd"],
    ["Apotheke Ost", "Apotheke West"], ["Miete Nord", "Miete Süd"],
    ["Erika Mustermann", "Max Mustermann"], ["Max Mustermann", "Max Musterfrau"],
    ["dm", "Admiral"], ["Fiktivladen", "Fiktivladenhalle"],
  ]) {
    const result = identities(left, right);
    assert.notEqual(result[0], result[1], `${left} / ${right}`);
  }
  // Word rules can match inside a longer text, just as the category matcher does; whole merchants cannot.
  assert.equal(identities("MGP Vinted - Kleiderkreisel")[0], "vinted");
  assert.equal(identities("Fiktivbetrieb Penny")[0], "fiktivbetrieb penny");
  assert.deepEqual(identities("REWE Reisen", "REWE"), ["rewe reisen", "rewe"]);
});

test("cut-off names take the longest eligible completion at a word boundary or in its last word", () => {
  for (const [short, long, identity] of [
    ["autobahnen und schnellstrassen-fin", "autobahnen und schnellstraßen-finanzierungs", "autobahnen und schnellstrassen finanzierungs"],
    ["muenchener rueckver", "muenchener rueckversic", "muenchener rueckversic"],
    ["Fiktivfirma Nord", "Fiktivfirma Nord Niederlassung", "fiktivfirma nord niederlassung"],
  ]) assert.deepEqual(identities(short, long), [identity, identity], short);
  const ambiguous = ["Fiktivfirma Haupt", "Fiktivfirma Hauptlager", "Fiktivfirma Haupthaus"];
  assert.deepEqual(shopIdentities(ambiguous), ["fiktivfirma hauptlager", "fiktivfirma hauptlager", "fiktivfirma haupthaus"]);
  // Equal lengths choose the lexical first completion, without merging the completions with each other.
  assert.deepEqual(shopIdentities(["Fiktivfirma Lang", "Fiktivfirma Langz", "Fiktivfirma Langa"]),
    ["fiktivfirma langa", "fiktivfirma langz", "fiktivfirma langa"]);
});

test("prefixes require 12 characters and cannot stop inside an earlier word", () => {
  assert.deepEqual(shopIdentities(["Fiktivshop1", "Fiktivshop12"]), ["fiktivshop1", "fiktivshop12"]);
  assert.deepEqual(shopIdentities(["Fiktivladenx", "Fiktivladenxyz"]), ["fiktivladenxyz", "fiktivladenxyz"]);
  const texts = ["Fiktivfirma Niederl", "Fiktivfirma Niederlassung West"];
  assert.deepEqual(shopIdentities(texts), texts.map((text) => text.toLowerCase()));
  // Sharp-s folding is exact, not an edit-distance rule for a missing internal s.
  const different = identities("autobahnen und schnellstrasen-fin", "autobahnen und schnellstraßen-finanzierungs");
  assert.notEqual(different[0], different[1]);
});

test("two to four digit-free words join by permutation or by equal first and last names", () => {
  assert.deepEqual(identities("Erika Mustermann", "Mustermann, Erika"), ["erika mustermann", "erika mustermann"]);
  assert.deepEqual(identities("Max Mustermann", "Max Otto Mustermann", "Mustermann Max", "Max Otto Emil Mustermann"),
    Array(4).fill("max mustermann"));
  assert.deepEqual(identities("Max Otto Mustermann", "Max Emil Mustermann"), Array(2).fill("max emil mustermann"));
  assert.deepEqual(identities("Erika Otto Emil Mustermann", "Mustermann Emil Erika Otto"), Array(2).fill("erika otto emil mustermann"));
  // A known identity anchors an otherwise unrecognised ordering.
  assert.deepEqual(identities("Apple Store", "Store Apple"), ["apple", "apple"]);
  for (const names of [["Max Otto Emil Karl Mustermann", "Mustermann Karl Emil Otto Max"],
    ["Max2 Mustermann", "Mustermann Max2"], ["Max Mustermann2", "Max Otto Mustermann2"]]) {
    const result = identities(...names);
    assert.notEqual(result[0], result[1], names.join(" / "));
  }
});

test("identity results are deterministic, order-independent, duplicate-preserving and set-local", () => {
  const keys = ["", "Max Mustermann", "Mustermann Max", "Max Otto Mustermann", "dm drogerie", "Vinted UAB",
    "MGP Vinted - Kleiderkreisel", "Fiktivfirma Haupt", "Fiktivfirma Hauptlager", "Fiktivfirma Haupthaus",
    "muenchener rueckver", "muenchener rueckversic", "Apple Store", "Store Apple", ""];
  const expected = shopIdentities(keys);
  assert.deepEqual(shopIdentities([...keys].reverse()).reverse(), expected);
  for (let shift = 1; shift < keys.length; shift++) {
    const rotated = [...keys.slice(shift), ...keys.slice(0, shift)];
    assert.deepEqual(shopIdentities(rotated), [...expected.slice(shift), ...expected.slice(0, shift)]);
  }
  assert.deepEqual(shopIdentities([...keys, ...keys]), [...expected, ...expected]);
  assert.deepEqual(shopIdentities(["muenchener rueckver"]), ["muenchener rueckver"]);
  assert.deepEqual(keys.slice(0, 2), ["", "Max Mustermann"]); // input not mutated
  // Name permutations/middle words and directional prefixes can form a cycle. Resolve it stably, once.
  const cycle = ["Fiktivname Nord", "Fiktivname Mitte Nord", "Fiktivname Nordost Nord",
    "Fiktivname Nordost", "Fiktivname Mitte Nordost"];
  assert.deepEqual(shopIdentities(cycle), Array(5).fill("fiktivname nord"));
  assert.deepEqual(shopIdentities([...cycle].reverse()), Array(5).fill("fiktivname nord"));
});

const exchangeLine = (amount = "7,43", exchange = "1,086700 1,00% Auslandsums. 0,07", date = "09.10.2026") =>
  `OPENAI          USA SAN FRANCISCO            USD ${amount} Kurs: ${exchange}Umsatz vom ${date} MC Hauptkarte`;

test("foreign card exchange rates and fees never enter the merchant key", () => {
  for (const line of [exchangeLine(), exchangeLine("24,17", "1,129500 1,75% Auslandsums. 0,42", "21.10.2026"),
    exchangeLine("1.234,50", "1,125000 "), exchangeLine().replace("Kurs:", "Kurs"),
    "FIKTIVSHOP USA BEISPIELORT USD 7,43 Kurs: 1,086700 Umsatz vom 09.10.2026 Visa Debit",
    // Paid in euros abroad: only the foreign-use fee, no exchange rate.
    "FIKTIVSHOP PTE. LTD.        SGP BEISPIELORT          EUR 5,44 1,00% Auslandsums. 0,05Umsatz vom 02.06.2026 MC Hauptkarte"]) {
    // The merchant key keeps a foreign legal form (stored rules depend on it); the shop identity drops it.
    const expected = line.includes("PTE. LTD.") ? "fiktivshop pte. ltd" : line.startsWith("FIKTIVSHOP") ? "fiktivshop" : "openai";
    for (const field of ["counterparty", "description", "bookingText"]) assert.equal(merchantKey({ [field]: line }), expected, line);
    // cardMerchant gives the printed name; merchantKey then trims its trailing dot.
    assert.equal(cardMerchant(line)?.merchant.replace(/\.$/u, ""), expected);
    assert.equal(shopIdentities([expected])[0], expected.startsWith("fiktivshop") ? "fiktivshop" : "openai");
  }
  assert.equal(cardMerchant(exchangeLine())?.town, "san francisco");
  assert.equal(merchantKey({ counterparty: "Fiktivpartner", description: exchangeLine() }), "fiktivpartner");
  for (const bad of [exchangeLine().replace("Umsatz vom", "Rechnung vom"),
    exchangeLine().replace("09.10.2026", ""), exchangeLine().replace("USA SAN FRANCISCO", "US MUSTERSTADT"),
    "Fiktivshop Kurs: 1,086700 Umsatz vom 09.10.2026 MC Hauptkarte"]) assert.equal(cardMerchant(bad), null, bad);
});

test("foreign card texts survive both VR readers, with stable import ids", () => {
  const csv = ["IBAN Auftragskonto;Buchungstag;Valutadatum;Name Zahlungsbeteiligter;Buchungstext;Verwendungszweck;Betrag;Währung;Soll/Haben;Saldo nach Buchung",
    `;10.10.2026;10.10.2026;;Kreditkartenabrechnung;${exchangeLine()};6,84;EUR;S;123,45`].join("\n");
  const server = parseVrBankCsv(csv).transactions[0];
  const phone = readBankText(csv).transactions[0];
  assert.equal(merchantKey({ ...server, amount: Number(server.amount) }), "openai");
  assert.equal(merchantKey({ ...phone, amount: Number(phone.amount) }), "openai");
  assert.equal(phone.externalId, server.externalId);
  assert.equal(server.externalId, parseVrBankCsv(csv).transactions[0].externalId);
});

test("learning remains keyed by merchant, but follows shop identities across absent learned payees", () => {
  const learned = learn({}, { counterparty: "MGP Vinted - Kleiderkreisel" }, "custom");
  assert.deepEqual(learned, { "mgp vinted - kleiderkreisel": "custom" });
  const payments = [{ counterparty: "Vinted, UAB", amount: -12 }, { counterparty: "Kleiderkreisel", amount: -13 }];
  const options = { categories: [...DEFAULT_CATEGORIES, { id: "custom" }], learned };
  assert.deepEqual(sortPayments(payments, options), Array(2).fill({ categoryId: "custom", source: "learned" }));
  assert.deepEqual(sortPayments(payments, { ...options, categories: DEFAULT_CATEGORIES }),
    Array(2).fill({ categoryId: "clothes", source: "starter" }));
  for (const [from, to] of [["Max Mustermann", "Mustermann Max"], ["Max Mustermann", "Max Otto Mustermann"],
    ["muenchener rueckver", "muenchener rueckversic"], ["Fiktivshop GmbH", "Fiktivshop LLC"],
    ["Apple Services", "apple.com bill"], ["dm drogerie", "DM DROGERIEMARKT"]]) {
    assert.deepEqual(sortPayments([{ counterparty: to }], { categories: [{ id: "custom" }],
      learned: learn({}, { counterparty: from }, "custom") }), [{ categoryId: "custom", source: "learned" }], from);
  }
});

test("exact learning wins, removed exact categories block fallback, and conflicts have a stable winner", () => {
  const payments = ["Vinted UAB", "Kleiderkreisel", "MGP Vinted - Kleiderkreisel"].map((counterparty) => ({ counterparty }));
  const learned = { "vinted uab": "second", kleiderkreisel: "first" };
  const options = { categories: [{ id: "first" }, { id: "second" }], learned };
  const results = sortPayments(payments, options);
  assert.deepEqual(results.map((result) => result.categoryId), ["second", "first", "first"]);
  assert.deepEqual(sortPayments([...payments].reverse(), { ...options, learned: { kleiderkreisel: "first", "vinted uab": "second" } }).reverse(), results);
  assert.deepEqual(sortPayments(payments, { categories: [{ id: "first" }], learned }).map((result) => result.categoryId),
    [null, "first", "first"]);
  assert.deepEqual(sortPayments([{ counterparty: "PayPal" }, { counterparty: "" }],
    { categories: [{ id: "first" }], learned: { "": "first" } }), Array(2).fill({ categoryId: null, source: null }));
});

test("identity learning leaves structural matches and unrelated existing starter rules intact", () => {
  const payments = [{ source: "bank" as const, counterparty: "PayPal", amount: -12, date: "2026-03-03" },
    { source: "paypal" as const, counterparty: "Vinted UAB", amount: -12, date: "2026-03-02" },
    { counterparty: "REWE", amount: -20 }, { counterparty: "Max Mustermann", amount: -5 }];
  assert.deepEqual(sortPayments(payments, { categories: [...DEFAULT_CATEGORIES, { id: "custom" }],
    learned: { "mgp vinted - kleiderkreisel": "custom", paypal: "custom", "erika mustermann": "custom" } }), [
    { categoryId: "own-transfers", source: "structural" }, { categoryId: "custom", source: "learned" },
    { categoryId: "groceries", source: "starter" }, { categoryId: null, source: null },
  ]);
});
