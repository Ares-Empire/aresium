import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { bundleEngine } from "../../scripts/build-engine.js";
import * as engine from "./index.js";
import { matchReceipt, type MatchPayment } from "./receipts/match.js";
import { readReceipt, type ReceiptReading } from "./receipts/read.js";
import { germanTime, readRegisterCode } from "./receipts/register-code.js";
import { latinLookAlikes, receiptRows, type Observation } from "./receipts/rows.js";
import { RECEIPT_WORDS, SHARED_WORDS } from "./receipts/words.js";
import { shopWords } from "./sorting/shop-words.js";

// Made-up receipts (fixtures/receipts/*.json): what Vision would give for them, boxes included. Real chain names;
// invented addresses, items, amounts, register ids and signatures.
const fixtures = new URL("fixtures/receipts/", import.meta.url);
const fixture = async (name: string) => JSON.parse(await readFile(new URL(`${name}.json`, fixtures), "utf8"));
// A receipt from plain lines, one piece per line, for small cases.
const lines = (...texts: string[]) => ({ observations: texts.map((text, i) => ({ text, x: 0.05, y: 0.05 + i * 0.03, width: 0.9, height: 0.02 })) });

type Expected = Omit<ReceiptReading, "rows">;
const sure = (shop: boolean, date: boolean, total: boolean, method: boolean) => ({ shop, date, total, method });
const EXPECTED: Record<string, Expected> = {
  "de-supermarket-card": { shop: "REWE", categoryId: "groceries", date: "2026-10-27", time: "14:32", total: 23.4, currency: "EUR", method: "card", language: "de", from: "text", sure: sure(true, true, true, true) },
  "de-bakery-cash": { shop: "Bäckerei Sonnenschein", categoryId: "coffee-snacks", date: "2026-10-28", time: "08:12", total: 7.85, currency: "EUR", method: "cash", language: "de", from: "text", sure: sure(true, true, true, true) },
  "de-drugstore": { shop: "dm", categoryId: "drugstore", date: "2026-10-29", time: "17:05", total: 12.85, currency: "EUR", method: "card", language: "de", from: "text", sure: sure(true, true, true, true) },
  "de-petrol": { shop: "Aral", categoryId: "car-fuel", date: "2026-10-30", time: "19:47", total: 75.29, currency: "EUR", method: "card", language: "de", from: "text", sure: sure(true, true, true, true) },
  "de-restaurant-tip": { shop: "Ristorante Da Luigi", categoryId: "eating-out", date: "2026-10-31", time: "21:15", total: 47, currency: "EUR", method: "card", language: "de", from: "text", sure: sure(true, true, true, true) },
  // The code wins: total 37.18 (printed 31,18 was misread), cash, and its time 22:30:41 UTC = 00:30 the next day in summer.
  "de-register-code": { shop: "EDEKA", categoryId: "groceries", date: "2026-07-15", time: "00:30", total: 37.18, currency: "EUR", method: "cash", language: "de", from: "code", sure: sure(true, true, true, true) },
  "de-long-two-pages": { shop: "Kaufland", categoryId: "groceries", date: "2026-11-02", time: "10:05", total: 80.48, currency: "EUR", method: "card", language: "de", from: "text", sure: sure(true, true, true, true) },
  // "SUMM EUR 14,O7" on a tilted receipt: found, but not sure (a misread total word).
  "de-noisy": { shop: "Netto Marken-Discount", categoryId: "groceries", date: "2026-11-03", time: "12:01", total: 14.07, currency: "EUR", method: "card", language: "de", from: "text", sure: sure(true, true, false, true) },
  "en-uk": { shop: "TESCO", categoryId: "groceries", date: "2026-10-27", time: "14:32", total: 12.5, currency: "GBP", method: "card", language: "en", from: "text", sure: sure(true, true, true, true) },
  "en-us": { shop: "WALGREENS", categoryId: null, date: "2026-10-27", time: "14:32", total: 23.4, currency: "USD", method: "cash", language: "en", from: "text", sure: sure(false, true, true, true) },
  "fr": { shop: "Carrefour Market", categoryId: "groceries", date: "2026-10-27", time: "14:32", total: 18.75, currency: "EUR", method: "card", language: "fr", from: "text", sure: sure(true, true, true, true) },
  "it": { shop: "ESSELUNGA S.p.A.", categoryId: null, date: "2026-10-27", time: "14:32", total: 15.6, currency: "EUR", method: "cash", language: "it", from: "text", sure: sure(false, true, true, true) },
  "es": { shop: "MERCADONA, S.A.", categoryId: null, date: "2026-10-27", time: "14:32", total: 34.56, currency: "EUR", method: "card", language: "es", from: "text", sure: sure(false, true, true, true) },
  "nl": { shop: "Albert Heijn", categoryId: null, date: "2026-10-27", time: "14:32", total: 11.85, currency: "EUR", method: "card", language: "nl", from: "text", sure: sure(false, true, true, true) },
  "pt": { shop: "PINGO DOCE", categoryId: null, date: "2026-10-27", time: "14:32", total: 9.87, currency: "EUR", method: "cash", language: "pt", from: "text", sure: sure(false, true, true, true) },
  "ch-francs": { shop: "MIGROS", categoryId: null, date: "2026-10-27", time: "14:32", total: 23.4, currency: "CHF", method: "cash", language: "de", from: "text", sure: sure(false, true, true, true) },
  // What Apple's Vision returned for a made-up receipt printed by the app agent (brief 31), on one page and on two.
  "vision-capture": { shop: "MUSTERMARKT LINDE", categoryId: null, date: "2026-10-26", time: "14:31", total: 27.65, currency: "EUR", method: "card", language: "de", from: "code", sure: sure(false, true, true, true) },
  "vision-capture-two-pages": { shop: "MUSTERMARKT LINDE", categoryId: null, date: "2026-10-26", time: "14:31", total: 27.65, currency: "EUR", method: "card", language: "de", from: "code", sure: sure(false, true, true, true) },
};

test("every receipt fixture is read as expected, and every fixture has an expectation", async () => {
  const files = (await readdir(fixtures)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
  assert.deepEqual(files, Object.keys(EXPECTED).sort());
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const { rows, ...reading } = readReceipt(await fixture(name));
    assert.deepEqual(reading, expected, name);
    assert.ok(rows.length > 5, name);
  }
});

test("rows: a label and its right-aligned price are one line, on a tilted receipt and across two pages", async () => {
  const noisy = readReceipt(await fixture("de-noisy")).rows;
  assert.deepEqual(noisy.slice(0, 5), ["Netto Marken-Discount", "Musterplatz 1", "12345 Musterstadt", "Gurken 0,79 B", "Joghurt O,49 B"]);
  assert.ok(noisy.includes("SUMM EUR 14,O7"));
  const long = readReceipt(await fixture("de-long-two-pages")).rows;
  assert.equal(long.length, 3 + 40 + 5);
  // The last lines of page 0, then the first of page 1.
  assert.deepEqual(long.slice(27, 31), ["Spülmittel 1,45 B", "Küchenrolle 2,79 B", "Müllbeutel 1,99 B", "Zahnbürste 1,49 B"]);
  assert.deepEqual(long.slice(-4), ["zu zahlen 80,48", "Kartenzahlung Maestro 80,48", "02.11.2026 10:05 Kasse 7", "Danke für Ihren Einkauf"]);
});

test("Vision's own output: prices a little above their labels, SUMME and its amount apart, the code and the printed text agree", async () => {
  for (const name of ["vision-capture", "vision-capture-two-pages"]) {
    const input = await fixture(name);
    // The register's code: card (Unbar), 2.10 + 25.55, finished 13:31:05 UTC = 14:31 in German winter time.
    assert.equal(input.codes.length, 1);
    assert.deepEqual(readRegisterCode(input.codes[0]), { total: 27.65, method: "card", date: "2026-10-26", time: "14:31" }, name);
    // Without the code, the printed text gives the same: "SUMME" + "EUR 27,65", "Geg. girocard", "26.10.2026" + "14:31".
    const { rows, ...text } = readReceipt({ ...input, codes: [] });
    assert.deepEqual(text, { ...EXPECTED[name], from: "text" }, name);
    assert.ok(rows.includes("SUMME EUR 27,65"), name);
    assert.ok(rows.includes("Geg. girocard EUR 27,65"), name);
    assert.ok(rows.includes("26.10.2026 14:31 Bon 4711 Kasse 2"), name);
    assert.ok(rows.includes("Vielen Dank für Ihren Einkauf!"), name);
    // Cyrillic look-alikes Vision put in: "3,49 А" and the VAT letter "в".
    assert.ok(rows.includes("DINKELBROT 500G 3,49 A") && rows.includes("B 19,0% 1,76 0,34 2,10"), name);
  }
  const rows = readReceipt(await fixture("vision-capture")).rows;
  assert.deepEqual(rows.slice(5, 12), ["BIO VOLLMILCH 1L 1,29 A", "DINKELBROT 500G 3,49 A", "ÄPFEL ELSTAR 1KG 2,99 A", "GOUDA JUNG 400G 4,79 A",
    "KAFFEE BOHNEN 1KG 12,99 A", "SPÜLMITTEL 500ML 1,85", "PFAND 0,25 B"]);
});

test("look-alike letters: Cyrillic and Greek in Latin text become Latin; Cyrillic and Greek words and lines stay", () => {
  assert.equal(latinLookAlikes("3,49 А"), "3,49 A");
  assert.equal(latinLookAlikes("в 19,0%"), "B 19,0%");
  assert.equal(latinLookAlikes("SUMMЕ EUR 9,99"), "SUMME EUR 9,99"); // Cyrillic Е
  assert.equal(latinLookAlikes("ΤΟΤΑL 9,99"), "TOTAL 9,99"); // Greek Τ, Ο, Α
  assert.equal(latinLookAlikes("Ουζο 0,7L 12,90"), "Ουζο 0,7L 12,90"); // a Greek word on a Latin line
  assert.equal(latinLookAlikes("Спасибо за покупку в магазине"), "Спасибо за покупку в магазине");
  assert.equal(latinLookAlikes("SUMME 9,99"), "SUMME 9,99");
  // The reader sees the Latin text: a total word with a Cyrillic letter is still a sure total.
  const reading = readReceipt(lines("SUMMЕ EUR 9,99", "Kartenzahlung"));
  assert.deepEqual([reading.total, reading.sure.total, reading.method, reading.rows[0]], [9.99, true, "card", "SUMME EUR 9,99"]);
});

test("rows: pieces at the same height but one above the other stay apart; broken pieces are skipped", () => {
  const box = (text: string, x: number, y: number, width = 0.2): Observation => ({ text, x, y, width, height: 0.02 });
  assert.deepEqual(receiptRows([
    box("23,40", 0.7, 0.101), box("SUMME EUR", 0.05, 0.1, 0.3), box("Bar", 0.05, 0.13), box("50,00", 0.7, 0.129),
    box("Seite 2", 0.05, 1.05), { text: "", x: 0, y: 0, width: 1, height: 1 }, { text: "x", x: Number.NaN, y: 0, width: 1, height: 1 },
  ]), ["SUMME EUR 23,40", "Bar 50,00", "Seite 2"]);
  assert.deepEqual(receiptRows([box("oben", 0.1, 0.1), box("unten", 0.12, 0.109)]), ["oben", "unten"]);
  assert.deepEqual(receiptRows([]), []);
});

test("the register's code: the DSFinV-K example, card and mixed payments, other processes and codes", () => {
  // DSFinV-K 2.4, Anhang I, section 2: the published example (its register id and key are the spec's own).
  const example = "V0;AMA-2642;Kassenbeleg-V1;Beleg^4.05_3.00_0.00_0.00_0.00^7.05:Bar;13;44131;2019-11-22T11:29:48.000Z;2019-11-22T11:29:49.000Z;ecdsa-plain-SHA384;unixTime;K8zsZ6NjsBzo;BBXNYQErM4d9";
  assert.deepEqual(readRegisterCode(example), { total: 7.05, method: "cash", date: "2019-11-22", time: "12:29" });
  const code = (data: string) => `V0;FIKTIV-1;Kassenbeleg-V1;${data};1;2;2026-01-05T09:00:00.000Z;2026-01-05T09:01:00.000Z;ecdsa-plain-SHA256;unixTime;U0lH;S0VZ`;
  assert.equal(readRegisterCode(code("Beleg^50.00_50.00_0.00_0.00_0.00^100.00:Unbar"))?.method, "card");
  // The spec's foreign-currency example: cash in three currencies and card; the total is the gross sum in EUR.
  assert.deepEqual(readRegisterCode(code("Beleg^75.33_7.99_0.00_0.00_0.00^10.00:Bar_5.00:Bar:CHF_5.00:Bar:USD_64.30:Unbar")),
    { total: 83.32, method: null, date: "2026-01-05", time: "10:01" });
  // A voucher paid most of it: the gross sum is what was paid.
  assert.equal(readRegisterCode(code("Beleg^60.00_60.00_0.00_0.00_-100.00^20.00:Bar"))?.total, 20);
  for (const other of [code("AVTraining^10.00_0.00_0.00_0.00_0.00^10.00:Bar"), code("Beleg^10.00_0.00_0.00^10.00:Bar"),
    code("Beleg^10.00_0.00_0.00_0.00_0.00^10.00:Karte"), "https://example.org/app", "4006381333931", "V1;x;Kassenbeleg-V1;Beleg^1.00_0.00_0.00_0.00_0.00^1.00:Bar;1;1;a;b"]) {
    assert.equal(readRegisterCode(other), null, other);
  }
});

test("TSE times are UTC: German summer and winter time switch at 01:00 UTC on the last Sundays of March and October", () => {
  assert.deepEqual(germanTime("2026-03-29T00:59:00.000Z"), { date: "2026-03-29", time: "01:59" });
  assert.deepEqual(germanTime("2026-03-29T01:00:00.000Z"), { date: "2026-03-29", time: "03:00" });
  assert.deepEqual(germanTime("2026-10-25T00:59:00.000Z"), { date: "2026-10-25", time: "02:59" });
  assert.deepEqual(germanTime("2026-10-25T01:00:00.000Z"), { date: "2026-10-25", time: "02:00" });
  assert.deepEqual(germanTime("2026-12-31T23:30:00Z"), { date: "2027-01-01", time: "00:30" });
  assert.deepEqual(germanTime("2026-12-31T23:30:00"), { date: "2026-12-31", time: "23:30" }); // no Z: as written
  assert.equal(germanTime("31.12.2026 23:30"), null);
});


test("dates: day first, except month first on a dollar receipt; an order that could go both ways is not sure", () => {
  const read = (...texts: string[]) => { const r = readReceipt(lines(...texts)); return [r.date, r.sure.date]; };
  assert.deepEqual(read("TOTAL 9,99", "05/10/2026 10:00"), ["2026-10-05", false]);
  assert.deepEqual(read("TOTAL $9.99", "05/10/2026 10:00"), ["2026-05-10", false]);
  assert.deepEqual(read("TOTAL $9.99", "13/10/2026 10:00"), ["2026-10-13", true]); // month first impossible
  assert.deepEqual(read("TOTAL 9,99", "10/27/2026 10:00"), ["2026-10-27", true]); // day first impossible
  assert.deepEqual(read("SUMME 9,99", "05.10.26 10:00"), ["2026-10-05", true]); // dots: always day first
  assert.deepEqual(read("TOTAL 9,99", "27 oct. 2026 10:00"), ["2026-10-27", true]);
  assert.deepEqual(read("TOTAL $9.99", "Oct 27, 2026 10:00 AM"), ["2026-10-27", true]);
  assert.deepEqual(read("TOTAAL 9,99", "27 mrt. 2026 10:00"), ["2026-03-27", true]);
  assert.deepEqual(read("SUMME 9,99", "Brillen 5 Augenoptik 2000"), [null, false]); // not a month
  // The purchase date stands with its time; a coupon's validity date does not count against it.
  assert.deepEqual(read("SUMME 9,99", "Coupon gültig bis 31.12.2026", "27.10.2026 10:00"), ["2026-10-27", true]);
  assert.deepEqual(read("SUMME 9,99", "28.10.2026 00:20", "TSE-Stop: 2026-10-27T23:20:10.000"), ["2026-10-28", true]); // UTC
  assert.deepEqual(read("SUMME 9,99", "Bon 27.10.2026 10:00", "Datum 28.10.2026 10:00"), ["2026-10-28", false]); // two dates
  assert.equal(readReceipt(lines("SUMME 9,99", "27.10.2026 12:30 PM")).time, "12:30");
  assert.equal(readReceipt(lines("TOTAL 9,99", "27/10/2026 à 9h05")).time, "09:05");
});

test("currency: signs next to prices, ISO codes anywhere, EUR when none, an undecided krone stays open", () => {
  const currency = (...texts: string[]) => readReceipt(lines(...texts)).currency;
  assert.equal(currency("SUMME 9,99"), "EUR");
  assert.equal(currency("Fr. 27.10.2026", "SUMME 9,99"), "EUR"); // Friday, not francs
  assert.equal(currency("Total Fr. 9.90"), "CHF");
  assert.equal(currency("Razem 12,50 zł"), "PLN");
  assert.equal(currency("Celkem 120,00 Kč"), "CZK");
  assert.equal(currency("Att betala 120,00 kr"), null);
  assert.equal(currency("Att betala 120,00 kr", "Tel +46 8 000 000"), "SEK");
  assert.equal(currency("I alt 120,00 kr", "DKK"), "DKK");
});

test("total, method and shop: nothing found is null, never invented; card and cash together are asked", () => {
  const empty = readReceipt({ observations: [] });
  assert.deepEqual(empty, { shop: null, categoryId: null, date: null, time: null, total: null, currency: "EUR", method: null,
    language: null, from: "text", rows: [], sure: { shop: false, date: false, total: false, method: false } });
  assert.equal(readReceipt(lines("SUMME 20,00", "Karte 10,00", "Bar 10,00")).method, null);
  // No total word: the change maths confirms a printed amount.
  const noWord = readReceipt(lines("Brot 2,50", "Kaffee 4,90", "7,40", "Gegeben 10,00", "Rückgeld 2,60"));
  assert.deepEqual([noWord.total, noWord.sure.total, noWord.method], [7.4, false, "cash"]);
  // Two totals that nothing explains: the later one, not sure.
  const twice = readReceipt(lines("Summe 12,00", "Summe 13,00"));
  assert.deepEqual([twice.total, twice.sure.total], [13, false]);
  // A deposit refund and a subtotal are never the total; "zu zahlen" beats "Summe".
  const deposit = readReceipt(lines("Zwischensumme 25,90", "Leergut -2,50", "Summe 25,90", "zu zahlen 23,40"));
  assert.deepEqual([deposit.total, deposit.sure.total], [23.4, true]);
  // "EC-Cash" is a card, not cash; "Rückgeld 0,00" on a card receipt is not cash.
  assert.equal(readReceipt(lines("SUMME 9,99", "EC-Cash 9,99", "Rückgeld 0,00")).method, "card");
  // A shop not on the list: the first name line, without a category, not sure; an address or phone line is no name.
  const fallback = readReceipt(lines("Musterweg 4", "Tel. 0123 456789", "Fiktivladen Sommer", "Brot 2,50", "SUMME 2,50"));
  assert.deepEqual([fallback.shop, fallback.categoryId, fallback.sure.shop], ["Fiktivladen Sommer", null, false]);
});

test("the words table: every phrase reads to words, and each language has the words the reader needs", () => {
  for (const [language, table] of Object.entries({ ...RECEIPT_WORDS, shared: SHARED_WORDS })) {
    for (const [kind, phrases] of Object.entries(table)) for (const phrase of phrases ?? []) {
      assert.ok(shopWords(phrase).length > 0, `${language} ${kind} "${phrase}"`);
    }
  }
  for (const [language, table] of Object.entries(RECEIPT_WORDS)) {
    for (const kind of ["total", "card", "cash", "given", "change", "tax"] as const) assert.ok(table[kind]?.length, `${language} ${kind}`);
  }
});

// ── Matching a receipt to its bank payment ───────────────────────────────────────────────────────────────

let n = 0;
const bank = (date: string, amount: number, counterparty: string, fields: Partial<MatchPayment> = {}): MatchPayment => ({
  id: `p${++n}`, date, amount, currency: "EUR", counterparty, description: `Kartenzahlung girocard ${counterparty}`, ...fields,
});
const rewe = { date: "2026-10-27", total: 23.4, currency: "EUR", shop: "REWE" };

test("exact: one payment with the amount to the cent, a similar shop, within 7 days: joined", () => {
  const payment = bank("2026-10-28", -23.4, "REWE SAGT DANKE 1234");
  assert.deepEqual(matchReceipt(rewe, [bank("2026-10-28", -23.4, "EDEKA Fiktiv"), payment, bank("2026-10-29", 23.4, "REWE Erstattung")]),
    { exact: payment.id, candidates: [] });
  // The shop as printed ("REWE Markt GmbH") and the bank's ("REWE 1234 MUSTERSTADT") are the same chain.
  assert.equal(matchReceipt({ ...rewe, shop: "REWE Markt GmbH" }, [payment]).exact, payment.id);
  // Not on the list: the receipt's name words in the bank text.
  const heijn = bank("2026-10-29", -11.85, "ALBERT HEIJN 1234 AMSTERDAM");
  assert.equal(matchReceipt({ date: "2026-10-27", total: 11.85, shop: "Albert Heijn" }, [heijn]).exact, heijn.id);
});

test("a bank text naming only a card processor counts as unknown, not as different", () => {
  const sumup = bank("2026-10-28", -23.4, "SumUp", { description: "SUMUP" });
  assert.equal(matchReceipt(rewe, [sumup]).exact, sumup.id);
  const named = bank("2026-10-28", -7.85, "SUMUP *BAECKEREI SONNENS");
  assert.equal(matchReceipt({ date: "2026-10-27", total: 7.85, shop: "Bäckerei Sonnenschein" }, [named]).exact, named.id);
  // A processor's name is cut out as a whole; the shop's own words stay.
  const planet = bank("2026-10-28", -59.9, "VR PAYMENT *PLANET SPORTS");
  assert.equal(matchReceipt({ date: "2026-10-27", total: 59.9, shop: "Planet Sports" }, [planet]).exact, planet.id);
  // Another bakery is a different shop, even with the same amount.
  const other = bank("2026-10-28", -7.85, "SUMUP *BAECKEREI MUELLER");
  assert.deepEqual(matchReceipt({ date: "2026-10-27", total: 7.85, shop: "Bäckerei Sonnenschein" }, [other]), { exact: null, candidates: [] });
});

test("two exact payments: asked, the named shop and the nearer day first", () => {
  const later = bank("2026-10-30", -23.4, "REWE SAGT DANKE 1234");
  const sooner = bank("2026-10-28", -23.4, "REWE SAGT DANKE 1234");
  const processor = bank("2026-10-27", -23.4, "SumUp", { description: "" });
  assert.deepEqual(matchReceipt(rewe, [later, processor, sooner]), { exact: null, candidates: [
    { id: sooner.id, why: "severalSame", days: 1, difference: 0 },
    { id: later.id, why: "severalSame", days: 3, difference: 0 },
    { id: processor.id, why: "severalSame", days: 0, difference: 0 },
  ] });
});

test("cash back and a tip: the bank took more (up to 200) at the same shop; slightly less (under 2 %) too", () => {
  const cashBack = bank("2026-10-28", -73.4, "REWE SAGT DANKE 1234");
  assert.deepEqual(matchReceipt(rewe, [cashBack]), { exact: null, candidates: [{ id: cashBack.id, why: "amountDiffers", days: 1, difference: 50 }] });
  const tip = bank("2026-11-02", -47, "SUMUP *DA LUIGI");
  assert.deepEqual(matchReceipt({ date: "2026-10-31", total: 42.5, shop: "Ristorante Da Luigi" }, [tip]).candidates,
    [{ id: tip.id, why: "amountDiffers", days: 2, difference: 4.5 }]);
  const less = bank("2026-10-28", -23, "REWE SAGT DANKE 1234"); // 1.7 % less
  const tooLittle = bank("2026-10-28", -22.9, "REWE SAGT DANKE 1234"); // 2.1 % less
  const tooMuch = bank("2026-10-28", -223.41, "REWE SAGT DANKE 1234");
  const unknownShop = bank("2026-10-28", -33.4, "SumUp", { description: "" });
  assert.deepEqual(matchReceipt(rewe, [tooMuch, tooLittle, unknownShop, less, cashBack]).candidates.map((c) => [c.id, c.difference]),
    [[less.id, -0.4], [cashBack.id, 50]]);
});

test("another currency: matched on the days and the shop only, never joined by itself", () => {
  const tesco = bank("2026-10-28", -14.37, "TESCO STORES 2345 LONDON");
  const elsewhere = bank("2026-10-28", -14.37, "PRET A MANGER LONDON");
  assert.deepEqual(matchReceipt({ date: "2026-10-27", total: 12.5, currency: "GBP", shop: "TESCO" }, [elsewhere, tesco]),
    { exact: null, candidates: [{ id: tesco.id, why: "otherCurrency", days: 1, difference: null }] });
});

test("already taken by another receipt, outside the 7 days, money in, or nothing at all: no match", () => {
  const taken = bank("2026-10-28", -23.4, "REWE SAGT DANKE 1234");
  assert.deepEqual(matchReceipt(rewe, [taken], [taken.id]), { exact: null, candidates: [] });
  assert.deepEqual(matchReceipt(rewe, [bank("2026-10-26", -23.4, "REWE 1"), bank("2026-11-04", -23.4, "REWE 2"),
    bank("2026-10-28", 23.4, "REWE 3")]), { exact: null, candidates: [] });
  assert.equal(matchReceipt(rewe, [bank("2026-11-03", -23.4, "REWE 4")]).candidates.length, 0);
  assert.equal(matchReceipt(rewe, [bank("2026-11-03", -23.4, "REWE SAGT DANKE")]).exact !== null, true); // day 7 still counts
  assert.deepEqual(matchReceipt(rewe, []), { exact: null, candidates: [] });
  assert.deepEqual(matchReceipt({ ...rewe, date: "27.10.2026" }, [taken]), { exact: null, candidates: [] });
});

test("at most five candidates", () => {
  const many = Array.from({ length: 7 }, (_, i) => bank(`2026-10-2${8 + (i % 2)}`, -23.4, "REWE SAGT DANKE 1234"));
  assert.equal(matchReceipt(rewe, many).candidates.length, 5);
});

// ── The bundle the app runs ──────────────────────────────────────────────────────────────────────────────

const context = createContext({}); // No Node require/process/Buffer or web APIs injected.
runInContext(await bundleEngine(), context);
const bundled = context.AresiumEngine as typeof engine;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

test("the bundle reads and matches receipts as the engine does", async () => {
  for (const name of Object.keys(EXPECTED)) {
    const input = await fixture(name);
    assert.deepEqual(json(bundled.readReceipt(input)), json(engine.readReceipt(input)), name);
  }
  const payments = [bank("2026-10-28", -23.4, "REWE SAGT DANKE 1234"), bank("2026-10-28", -73.4, "REWE SAGT DANKE 1234")];
  assert.deepEqual(json(bundled.matchReceipt(rewe, payments, [])), engine.matchReceipt(rewe, payments, []));
});
