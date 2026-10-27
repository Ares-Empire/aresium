import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { bundleEngine } from "../../scripts/build-engine.js";
import { MAX_READINGS, PREVIEW_PAYMENTS, readingsOfUnknownText, type FileReading } from "./readers/readings.js";
import * as engine from "./index.js";

// Made-up files only: real header styles, invented shops and amounts.
const context = createContext({});
runInContext(await bundleEngine(), context);
const bundled = context.AresiumEngine as typeof engine;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const utf8 = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));
const fixture = async (name: string) => (await readFile(new URL(`fixtures/banks/${name}`, import.meta.url))).toString("utf8");
const csv = (...lines: string[]) => lines.join("\n") + "\n";
const reasons = (readings: FileReading[]) => readings.map((r) => r.reason);
const amounts = (reading: FileReading) => reading.preview.map((t) => t.amount);
const days = (reading: FileReading) => reading.preview.map((t) => t.bookingDate.slice(0, 10));

// What every list of readings promises: at most four, the guess first when it reads the file, each a complete layout
// that the import reads the whole file with (the app saves it and calls readBankFile again), its preview the first
// payments of that import, and no two that look the same.
function checkReadings(text: string, readings: FileReading[]) {
  assert.ok(readings.length <= MAX_READINGS);
  const counts = readings.map((r) => engine.readBankText(text, [json({ ...r.layout, name: "Fiktivbank" })]).transactions);
  for (const [i, reading] of readings.entries()) {
    assert.equal(reading.layout.version, 1);
    assert.deepEqual(json(reading.preview), json(counts[i].slice(0, PREVIEW_PAYMENTS)), `reading ${i}: preview`);
    assert.equal(counts[i].length, counts[0].length, `reading ${i} reads every payment`);
  }
  const shown = readings.map((r) => JSON.stringify(r.preview.map((t) => [t.bookingDate, t.counterparty, t.description, t.amount])));
  assert.equal(new Set(shown).size, shown.length, "no two readings look the same");
}

test("an ambiguous date (03/04/2026) is read day first, then month first", () => {
  const text = csv("Datum;Empfänger;Verwendungszweck;Betrag",
    "03/04/2026;Fiktiv Markt;Einkauf;-12,00",
    "03/04/2026;Fiktiv Café;Kaffee;-3,50",
    "05/06/2026;Fiktiv Werke GmbH;Gehalt;1.200,00");
  const readings = readingsOfUnknownText(text);
  checkReadings(text, readings);
  assert.deepEqual(reasons(readings).slice(0, 2), [null, "dateFormat"]);
  assert.equal(readings[0].layout.dateFormat, "DD/MM/YYYY");
  assert.deepEqual(days(readings[0]), ["2026-04-03", "2026-04-03", "2026-06-05"]);
  assert.equal(readings[1].layout.dateFormat, "MM/DD/YYYY");
  assert.deepEqual(days(readings[1]), ["2026-03-04", "2026-03-04", "2026-05-06"]);
  assert.deepEqual(readings[1].layout.columns, readings[0].layout.columns, "only the date order changes");
});

test("a reading that would lose a payment is never offered: no month-first reading when a day is 13", () => {
  const text = csv("Datum;Empfänger;Verwendungszweck;Betrag",
    "03/02/2026;Fiktiv Markt;Einkauf;-12,00",
    "13/02/2026;Fiktiv Werke GmbH;Gehalt;1.200,00");
  const readings = readingsOfUnknownText(text);
  checkReadings(text, readings);
  assert.ok(!reasons(readings).includes("dateFormat"));
});

test("debit and credit with nothing to tell them apart: left as money out first, then the other way", () => {
  const text = csv("Datum;Text;Spalte 1;Spalte 2",
    "02.02.2026;Fiktiv Markt Einkauf;12,00;",
    "03.02.2026;Fiktiv Werke Gehalt;;100,00",
    "04.02.2026;Fiktiv Café;3,50;");
  const readings = readingsOfUnknownText(text);
  checkReadings(text, readings);
  assert.deepEqual(reasons(readings).slice(0, 2), [null, "debitCredit"]);
  assert.deepEqual([readings[0].layout.columns.debit, readings[0].layout.columns.credit], [2, 3]);
  assert.deepEqual(amounts(readings[0]), ["-12.00", "100.00", "-3.50"]);
  assert.deepEqual([readings[1].layout.columns.debit, readings[1].layout.columns.credit], [3, 2]);
  assert.deepEqual(amounts(readings[1]), ["12.00", "-100.00", "3.50"]);
});

test("debit and credit the guess read as one amount column: the readings use both, and the guess is left out", () => {
  // "Betrag" is an amount word, so the guess reads only the first column and loses the money in.
  const text = csv("Datum;Text;Betrag Soll;Betrag Haben",
    "02.02.2026;Fiktiv Markt Einkauf;12,00;",
    "03.02.2026;Fiktiv Werke Gehalt;;100,00",
    "04.02.2026;Fiktiv Café;3,50;");
  assert.equal(engine.guessCsvLayout(text).preview.length, 2);
  const readings = readingsOfUnknownText(text);
  checkReadings(text, readings);
  assert.deepEqual(reasons(readings), ["debitCredit", "debitCredit"]);
  assert.deepEqual(amounts(readings[0]), ["-12.00", "100.00", "-3.50"]);
  assert.deepEqual(amounts(readings[1]), ["12.00", "-100.00", "3.50"]);
});

test("the other party and the text the other way round", async () => {
  // A card export whose "Beschreibung" is the shop: the guess reads it as the text, with no other party.
  const card = csv("Datum;Beschreibung;Details;Betrag",
    "02.02.2026;FIKTIV MARKT BERLIN;Kartenzahlung girocard;-12,00",
    "03.02.2026;FIKTIV CAFE;Kartenzahlung girocard;-3,50",
    "04.02.2026;FIKTIV WERKE GMBH;Gehalt Februar;1.200,00");
  const readings = readingsOfUnknownText(card);
  checkReadings(card, readings);
  assert.deepEqual(reasons(readings).slice(0, 3), [null, "counterpartyText", "counterparty"]);
  assert.deepEqual([readings[0].preview[0].counterparty, readings[0].preview[0].description], [null, "FIKTIV MARKT BERLIN"]);
  assert.deepEqual([readings[1].preview[0].counterparty, readings[1].preview[0].description], ["FIKTIV MARKT BERLIN", "Kartenzahlung girocard"]);
  assert.deepEqual([readings[2].preview[0].counterparty, readings[2].preview[0].description], ["Kartenzahlung girocard", "FIKTIV MARKT BERLIN"]);

  // Both found by their header words: the swap is still offered, after the guess. A balance that moves by the
  // amounts proves their sign, and 13/02 rules out month first, so neither is offered.
  const english = await fixture("unknown-english.csv");
  const offered = readingsOfUnknownText(english);
  checkReadings(english, offered);
  assert.deepEqual(reasons(offered), [null, "counterpartyText", "valueDate"]);
  assert.deepEqual(offered[1].layout.columns.counterparty, [3]);
  assert.deepEqual(offered[1].layout.columns.text, [2]);
  assert.deepEqual(days(offered[2]), ["2026-02-14", "2026-02-14", "2026-02-16"]);
});

test("amounts without signs: a column of Lastschrift/Gutschrift marks, else every amount as money out", () => {
  const marked = csv("Datum;Empfänger;Zweck;Betrag;Art",
    "02.02.2026;Fiktiv Markt;Einkauf;12,00;Lastschrift",
    "03.02.2026;Fiktiv Werke GmbH;Gehalt;100,00;Gutschrift");
  const withMarks = readingsOfUnknownText(marked);
  checkReadings(marked, withMarks);
  assert.deepEqual(reasons(withMarks).slice(0, 3), [null, "sign", "invertSign"]);
  assert.deepEqual(amounts(withMarks[1]), ["-12.00", "100.00"]);
  assert.equal(withMarks[1].layout.columns.sign, 4);

  // A card statement listing its purchases as positive amounts.
  const card = csv("Datum;Beschreibung;Betrag", "02.02.2026;FIKTIV MARKT;12,00", "03.02.2026;FIKTIV CAFE;3,50");
  const readings = readingsOfUnknownText(card);
  checkReadings(card, readings);
  assert.deepEqual(reasons(readings).slice(0, 2), [null, "invertSign"]);
  assert.equal(readings[1].layout.invertSign, true);
  assert.deepEqual(amounts(readings[1]), ["-12.00", "-3.50"]);
});

test("a file without a header row gets readings too, recognised again by its shape", () => {
  const text = csv("03/02/2026;Fiktiv Markt Einkauf;-23,17;'DE53300209000000556677'",
    "04/02/2026;Fiktiv Werke Gehalt;1.800,00;'DE53300209000000556677'");
  const readings = readingsOfUnknownText(text);
  checkReadings(text, readings);
  assert.deepEqual(reasons(readings).slice(0, 2), [null, "dateFormat"]);
  assert.ok(readings.every((r) => r.layout.header.length === 0 && r.layout.columnCount === 4));
});

test("known banks, saved layouts, CAMT, MT940, PayPal and files without an amount get no readings", async () => {
  for (const name of ["sparkasse-camt.csv", "volksbank.csv", "camt053-v08.xml", "mt940.sta", "paypal-statement-de.csv"]) {
    assert.deepEqual(engine.readingsOfUnknownFile(new Uint8Array(await readFile(new URL(`fixtures/banks/${name}`, import.meta.url)))), [], name);
  }
  const unknown = await fixture("unknown-fiktivbank.csv");
  const [first] = readingsOfUnknownText(unknown);
  assert.ok(first);
  assert.deepEqual(readingsOfUnknownText(unknown, [first.layout]), [], "a saved layout reads it");
  assert.deepEqual(readingsOfUnknownText(csv("Datum;Text;Notiz", "02.02.2026;Fiktiv Markt;Brot", "03.02.2026;Fiktiv Café;Kaffee")), []);
  assert.deepEqual(engine.readingsOfUnknownFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0])), []);
  assert.deepEqual(engine.readingsOfUnknownFile(new Uint8Array([])), []);
});

test("the readings from bytes, in Node and in the bundled engine, equal those of the text", async () => {
  for (const name of ["unknown-fiktivbank.csv", "unknown-english.csv"]) {
    const bytes = new Uint8Array(await readFile(new URL(`fixtures/banks/${name}`, import.meta.url)));
    const readings = engine.readingsOfUnknownFile(bytes);
    assert.ok(readings.length >= 2, name);
    assert.deepEqual(json(readings), json(readingsOfUnknownText(await fixture(name))));
    assert.deepEqual(json(bundled.readingsOfUnknownFile(bytes)), json(readings));
  }
  const text = csv("Datum;Text;Spalte 1;Spalte 2", "02.02.2026;Fiktiv Markt Einkauf;12,00;", "03.02.2026;Fiktiv Werke Gehalt;;100,00");
  assert.deepEqual(json(bundled.readingsOfUnknownFile(utf8(text))), json(engine.readingsOfUnknownFile(utf8(text))));
});
