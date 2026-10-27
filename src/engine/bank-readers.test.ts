import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { bundleEngine } from "../../scripts/build-engine.js";
import { bankFixtures, fixtureAnswer } from "../../scripts/bank-fixtures.js";
import { parseCamt } from "../import/camt.js";
import { parseVrBankCsv } from "../import/vrbank-csv.js";
import { detectSeparator, splitCsv } from "./readers/csv.js";
import { decodeBankFileWithEncoding } from "./readers/decode.js";
import { canonicalAmount, normalizeIban, parseAmountStrict, parseDate } from "./readers/values.js";
import * as engine from "./index.js";

const context = createContext({}); // No Node require/process/Buffer or web APIs injected.
runInContext(await bundleEngine(), context);
const bundled = context.AresiumEngine as typeof engine;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const fixture = (name: string) => readFile(new URL(`fixtures/banks/${name}`, import.meta.url));
const utf8 = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));
const ids = (file: engine.BankFile) => file.transactions.map((t) => t.externalId);

// Windows-1252 bytes for text made of its characters (the test's own encoder, checked against Node's decoder).
const HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
function windows1252(text: string): Uint8Array | null {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const high = HIGH.indexOf(ch);
    if (high >= 0) bytes.push(0x80 + high);
    else if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
    else return null;
  }
  return new Uint8Array(bytes);
}

// ── Decoding ────────────────────────────────────────────────────────────────────────────────────────────────

test("decodes UTF-8 with and without a byte order mark", () => {
  const text = "Grüße, Äpfel, Öl, Straße, 12,34 €, 🥨";
  assert.deepEqual(decodeBankFileWithEncoding(utf8(text)), { text, encoding: "utf-8" });
  assert.deepEqual(decodeBankFileWithEncoding(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(text)])), { text, encoding: "utf-8" });
  assert.equal(engine.decodeBankFile(utf8(text)), text);
});
test("decodes Windows-1252 and ISO-8859-1 umlauts when the bytes are not UTF-8", () => {
  // "Müller;Gebühr 5,00 €" in Windows-1252, and "Grüße Öl" as ISO-8859-1 writes it (the same bytes for umlauts).
  const win = new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x3b, 0x47, 0x65, 0x62, 0xfc, 0x68, 0x72, 0x20, 0x35, 0x2c, 0x30, 0x30, 0x20, 0x80]);
  assert.deepEqual(decodeBankFileWithEncoding(win), { text: "Müller;Gebühr 5,00 €", encoding: "windows-1252" });
  const latin1 = new Uint8Array([0x47, 0x72, 0xfc, 0xdf, 0x65, 0x20, 0xd6, 0x6c, 0x20, 0xc4, 0xe4, 0xdc]);
  assert.equal(engine.decodeBankFile(latin1), "Grüße Öl ÄäÜ");
});
test("the Windows-1252 table equals Node's decoder for every byte", () => {
  const all = new Uint8Array(256).map((_, i) => i);
  // 0xC3 0x28 etc. make this invalid UTF-8, so the Windows-1252 path is taken.
  assert.equal(engine.decodeBankFile(all), new TextDecoder("windows-1252").decode(all));
});
test("rejects broken UTF-8 (overlong, lone continuation, surrogates, cut off) in favour of Windows-1252", () => {
  for (const bytes of [[0xc0, 0x80], [0x80], [0xed, 0xa0, 0x80], [0x41, 0xe2, 0x82], [0xf5, 0x80, 0x80, 0x80]]) {
    assert.equal(decodeBankFileWithEncoding(new Uint8Array(bytes)).encoding, "windows-1252");
  }
});
test("decodes UTF-16 files with a byte order mark, and large files without running out of stack", () => {
  const text = "Datum;Betrag\n01.02.2026;-3,20 €";
  const le = [0xff, 0xfe];
  for (const ch of text) le.push(ch.charCodeAt(0) & 255, ch.charCodeAt(0) >> 8);
  assert.deepEqual(decodeBankFileWithEncoding(new Uint8Array(le)), { text, encoding: "utf-16le" });
  const big = "Grüße;12,34\n".repeat(50000);
  assert.equal(engine.decodeBankFile(utf8(big)), big);
  assert.equal(engine.decodeBankFile(windows1252(big)!), big);
});

// ── CSV and cell values ─────────────────────────────────────────────────────────────────────────────────────

test("splits CSV with quotes, doubled quotes, separators and line breaks inside quotes, and stray quotes", () => {
  const text = 'a;"b;c";"say ""hi"""\r\n"multi\nline";5" screen;x\n"never closed;y';
  assert.deepEqual(splitCsv(text, ";"), [
    ["a", "b;c", 'say "hi"'], ["multi\nline", '5" screen', "x"], ["never closed;y"],
  ]);
});
test("finds the separator the table uses", () => {
  assert.equal(detectSeparator("Datum;Text;Betrag\n01.02.2026;Kaffee, Kuchen;-3,20\n02.02.2026;Brot;-2,10\n"), ";");
  assert.equal(detectSeparator('Date,Description,Amount\n2026-02-01,"Coffee; cake",-3.20\n2026-02-02,Bread,-2.10\n'), ",");
  assert.equal(detectSeparator("Date\tText\tAmount\n2026-02-01\tCoffee, cake\t-3.20\n"), "\t");
});
test("reads amounts strictly in the stated number format", () => {
  const de: [string, string | null][] = [["-1.234,56", "-1234.56"], ["12,3", "12.30"], ["12,34-", "-12.34"], ["+5", "5.00"],
    ["1.234,56 €", "1234.56"], ["EUR -0,99", "-0.99"], ["−7,00", "-7.00"], ["-0,00", "0.00"], ["0,1234", "0.1234"],
    ["12.34", null], ["01.02.2026", null], ["abc", null], ["", null]];
  for (const [input, want] of de) assert.equal(parseAmountStrict(input, "de"), want, input);
  const en: [string, string | null][] = [["-1,234.56", "-1234.56"], ["(12.50)", "-12.50"], ["$3.2", "3.20"], ["12,34", null]];
  for (const [input, want] of en) assert.equal(parseAmountStrict(input, "en"), want, input);
  assert.equal(canonicalAmount(false, "007", "5000"), "7.50");
});
test("reads dates strictly, with the time ignored and impossible dates refused", () => {
  assert.equal(parseDate("05.02.2026", "DD.MM.YYYY"), "2026-02-05");
  assert.equal(parseDate("5.2.26", "DD.MM.YY"), "2026-02-05");
  assert.equal(parseDate("2026-02-05 10:22:33", "YYYY-MM-DD"), "2026-02-05");
  assert.equal(parseDate("02/05/2026", "MM/DD/YYYY"), "2026-02-05");
  assert.equal(parseDate("20260205", "YYYYMMDD"), "2026-02-05");
  for (const [v, f] of [["30.02.2026", "DD.MM.YYYY"], ["13/13/2026", "DD/MM/YYYY"], ["37040044", "YYYYMMDD"], ["offen", "DD.MM.YYYY"]] as const) {
    assert.equal(parseDate(v, f), null, v);
  }
});
test("checks IBANs by their check digits", () => {
  assert.equal(normalizeIban("DE89 3704 0044 0532 0130 00"), "DE89370400440532013000");
  assert.equal(normalizeIban("DE88370400440532013000"), null);
  assert.equal(normalizeIban("0532013000"), null);
});

// ── Ids ────────────────────────────────────────────────────────────────────────────────────────────────────

const unknownCsv = (rows: string[]) =>
  ["Fiktivbank Kontoauszug", "", "Datum;Empfänger;Zweck;Betrag;Saldo", ...rows].join("\n") + "\n";
const ROWS = [
  "01.02.2026;Märchenbäckerei;Brötchen;-3,20;996,80",
  "01.02.2026;Märchenbäckerei;Brötchen;-3,20;993,60",
  "03.02.2026;Fiktivbüro;Erstattung;23,45;1.017,05",
  "04.02.2026;Fiktiv Markt;Einkauf;-12,00;1.005,05",
];

test("two identical payments on one day stay two, with ids stable across overlapping imports", () => {
  const guess = engine.guessCsvLayout(unknownCsv(ROWS));
  assert.ok(guess.layout);
  const all = engine.readCsv(unknownCsv(ROWS), guess.layout);
  assert.equal(new Set(ids(all)).size, 4);
  const early = engine.readCsv(unknownCsv(ROWS.slice(0, 3)), guess.layout);
  const late = engine.readCsv(unknownCsv(ROWS.slice(2)), guess.layout);
  assert.deepEqual(ids(early), ids(all).slice(0, 3));
  assert.deepEqual(ids(late), ids(all).slice(2));
});

test("ids ignore columns the person edits in online banking (category, note)", async () => {
  const text = (await fixture("commerzbank.csv")).toString("utf8");
  const edited = text.replace(";Wohnen\n", ";Haushalt\n").replace(";Einkommen\n", ";\n");
  assert.notEqual(edited, text);
  assert.deepEqual(ids(engine.readBankText(edited)), ids(engine.readBankText(text)));
});

// ── The server's readers keep their ids ───────────────────────────────────────────────────────────────────

test("VR Bank CSV keeps the server reader's ids; a repeated booking gets its own; a row without a date is skipped", async () => {
  const text = (await fixture("../vrbank.csv")).toString("utf8");
  const file = engine.readBankFile(utf8(text));
  assert.equal(file.bank?.id, "volksbank");
  assert.deepEqual(ids(file), parseVrBankCsv(text).transactions.map((t) => t.externalId));
  const lines = text.trimEnd().split("\n");
  const doubled = [...lines, lines[1], ";;;;Summe;;0,00;EUR;;"].join("\n");
  const again = engine.readBankFile(utf8(doubled));
  const old = parseVrBankCsv(doubled).transactions.map((t) => t.externalId);
  assert.deepEqual(ids(again).slice(0, 2), old.slice(0, 2));
  assert.equal(old[2], old[0]); // the server's reader gave the repeat the same id
  assert.notEqual(ids(again)[2], ids(again)[0]);
  assert.equal(again.transactions.length, 3);
  assert.equal(again.skipped, 1);
});
test("VR CAMT keeps the server reader's ids; a repeat gets its own; pending entries are skipped", async () => {
  const text = (await fixture("camt052-vr.xml")).toString("utf8");
  const old = parseCamt(text).transactions.map((t) => t.externalId);
  const file = engine.readBankFile(utf8(text));
  assert.deepEqual(ids(file).slice(0, 2), old.slice(0, 2));
  assert.equal(old[2], old[1]);
  assert.notEqual(ids(file)[2], ids(file)[1]);
  assert.equal(file.transactions.length, 3);
  assert.equal(file.skipped, 1);
  const original = (await fixture("../camt.xml")).toString("utf8");
  assert.deepEqual(ids(engine.readBankFile(utf8(original))), parseCamt(original).transactions.map((t) => t.externalId));
});
test("PayPal keeps its transaction codes as ids", async () => {
  const file = engine.readBankFile(await fixture("../paypal.csv"));
  assert.equal(file.format, "paypal");
  assert.deepEqual(ids(file), ["FICTIONAL-PAY-1", "FICTIONAL-FUND", "FICTIONAL-REFUND"]);
});

// ── CAMT and MT940 ─────────────────────────────────────────────────────────────────────────────────────────

test("CAMT from other banks: the bank reference or a hash, never the payer's EndToEndId", async () => {
  const camt054 = engine.readBankFile(await fixture("camt054.xml"));
  assert.equal(camt054.transactions[0].externalId, "FICT-DKB-9001");
  assert.notEqual(camt054.transactions[1].externalId, "REUSED-EVERY-MONTH");
  assert.equal(camt054.transactions[0].bookingDate, "2026-02-06T00:00:00.000Z"); // the date as written, not UTC
  const camt053 = engine.readBankFile(await fixture("camt053-v08.xml"));
  assert.deepEqual(camt053.transactions.map((t) => t.counterparty), ["Fiktiv Werke GmbH", "Café Märchen", "Café Märchen", "Fiktiv Stadtwerke"]);
  assert.deepEqual(camt053.transactions.map((t) => t.balance), ["2300.00", "2296.80", "2293.60", "2257.20"]);
  assert.equal(new Set(ids(camt053)).size, 4);
});
test("CAMT gives no balances when the entries do not add up to the closing balance", async () => {
  const text = (await fixture("camt053-v08.xml")).toString("utf8").replace("<Amt Ccy=\"EUR\">2257.20</Amt>", "<Amt Ccy=\"EUR\">2257.21</Amt>");
  assert.ok(engine.readBankText(text).transactions.every((t) => t.balance === undefined));
});
test("MT940: German :86: subfields, reversals, the year boundary, balances, repeats", async () => {
  const file = engine.readBankFile(await fixture("mt940.sta"));
  const [first, , coffee1, coffee2, reversal] = file.transactions;
  assert.equal(first.bookingDate, "2026-01-02T00:00:00.000Z");
  assert.equal(first.valueDate, "2025-12-31T00:00:00.000Z");
  assert.equal(first.counterparty, "Fiktiv Streaming Deutschland GmbH");
  assert.equal(first.description, "Fiktiv Streaming Monatsabo Januar");
  assert.equal(reversal.amount, "19.99");
  assert.notEqual(coffee1.externalId, coffee2.externalId);
  assert.equal(file.transactions.at(-1)!.balance, "1398.60");
});
test("MT942 (intraday, not booked yet) statements are skipped", () => {
  const text = [":20:FICT", ":25:76050101/0000987654", ":28C:1", ":34F:EUR0,", ":13D:2602051200+0100",
    ":61:2602050205DR9,99NMSCNONREF", ":86:005?00KARTENZAHLUNG?20Vorgemerkt", "-"].join("\r\n");
  const file = engine.readBankText(text);
  assert.equal(file.transactions.length, 0);
  assert.equal(file.skipped, 1);
});

// ── Detection ──────────────────────────────────────────────────────────────────────────────────────────────

test("detects CAMT, MT940, PayPal, known and unknown CSVs, and refuses ZIP archives", async () => {
  assert.deepEqual(engine.detectBankFile((await fixture("camt053-v08.xml")).toString()), { format: "camt", message: "camt.053.001.08" });
  assert.deepEqual(engine.detectBankFile((await fixture("mt940.sta")).toString()), { format: "mt940" });
  assert.equal(engine.detectBankFile((await fixture("../paypal.csv")).toString()).format, "paypal");
  const unknown = engine.detectBankFile(unknownCsv(ROWS));
  assert.deepEqual(unknown, { format: "csv", separator: ";", headerRow: 2 });
  assert.throws(() => engine.readBankFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0])), { code: "zip" });
  assert.throws(() => engine.readBankText("<html></html>"), { code: "camt" });
  assert.throws(() => engine.readBankText("just some words\nand more words\n"), { code: "noTable" });
});

// ── Unknown CSVs ───────────────────────────────────────────────────────────────────────────────────────────

test("an unknown CSV comes back with a guessed layout to confirm, and is read with it once confirmed", () => {
  const bytes = utf8(unknownCsv(ROWS));
  const first = engine.readBankFile(bytes);
  assert.equal(first.transactions.length, 0);
  const guess = first.needsLayout!;
  assert.deepEqual(guess.layout?.columns, { date: 0, counterparty: [1], text: [2], amount: 3, balance: 4 });
  assert.equal(guess.confidence, 1);
  assert.equal(guess.preview.length, 4);
  // The app saves the confirmed layout as JSON and passes it back with the next file.
  const saved = JSON.parse(JSON.stringify({ ...guess.layout, name: "Fiktivbank" }));
  const second = engine.readBankFile(bytes, [saved]);
  assert.equal(second.needsLayout, undefined);
  assert.deepEqual(second.transactions, guess.preview);
  assert.equal(second.account?.name, "Fiktivbank");
  assert.deepEqual(json(bundled.readBankFile(bytes, [saved])), json(second));
});
test("the guess finds debit and credit columns, an S/H marker, English numbers and dates, and the balance", () => {
  const debitCredit = engine.guessCsvLayout(["Datum;Wertstellung;Empfänger;Zweck;Ausgang;Eingang;Kontostand",
    "02.02.2026;02.02.2026;Märchenbäckerei;Brötchen;3,20;;996,80",
    "05.02.2026;06.02.2026;Fiktivbüro;Erstattung;;23,45;1.020,25"].join("\n"));
  assert.deepEqual(debitCredit.layout?.columns, { date: 0, valueDate: 1, debit: 4, credit: 5, counterparty: [2], text: [3], balance: 6 });
  assert.deepEqual(debitCredit.preview.map((t) => t.amount), ["-3.20", "23.45"]);
  const marker = engine.guessCsvLayout(["Tag;Vorgang;Umsatz;S/H", "02.02.2026;Kartenzahlung Fiktiv Markt;12,00;S",
    "03.02.2026;Gutschrift Fiktivbüro;20,00;H"].join("\n"));
  assert.equal(marker.layout?.columns.sign, 3);
  assert.deepEqual(marker.preview.map((t) => t.amount), ["-12.00", "20.00"]);
  // No header words for the amount: the column the balance moves by is the amount.
  const english = engine.guessCsvLayout(['Posted,Merchant,Col A,Col B', '13/02/2026,"Fiktiv Shop, Ltd",-1.50,"1,000.00"',
    '14/02/2026,Fiktiv Cafe,-2.25,997.75', '15/02/2026,Fiktiv Payroll,"2,000.00","2,997.75"'].join("\n"));
  assert.equal(english.layout?.numberFormat, "en");
  assert.equal(english.layout?.dateFormat, "DD/MM/YYYY");
  assert.equal(english.layout?.columns.balance, 3);
  assert.deepEqual(english.preview.map((t) => t.amount), ["-1.50", "-2.25", "2000.00"]);
});
test("without header words, the balance tells money out from money in", () => {
  // Columns A and B are never filled in the same row; the balance falls by A and rises by B.
  const guess = engine.guessCsvLayout(["Datum;Text;A;B;Stand", "02.02.2026;Fiktiv Markt;12,00;;988,00",
    "03.02.2026;Fiktiv Werke GmbH;;100,00;1.088,00", "04.02.2026;Fiktiv Cafe;3,50;;1.084,50"].join("\n"));
  assert.equal(guess.layout?.columns.debit, 2);
  assert.equal(guess.layout?.columns.credit, 3);
  assert.equal(guess.layout?.columns.balance, 4);
  assert.deepEqual(guess.preview.map((t) => t.amount), ["-12.00", "100.00", "-3.50"]);
  assert.ok(!guess.unsure.includes("amount"));
});
test("a file without a header row is guessed, confirmed and read again by its shape", () => {
  const text = ["03.02.2026;Fiktiv Markt Einkauf;-23,17;'DE53300209000000556677'",
    "04.02.2026;Fiktiv Werke Gehalt;1.800,00;'DE53300209000000556677'"].join("\n");
  const first = engine.readBankText(text);
  const guess = first.needsLayout!;
  assert.equal(guess.headerRow, -1);
  assert.deepEqual(guess.layout?.header, []);
  assert.deepEqual(guess.columns.map((c) => c.header), ["Column 1", "Column 2", "Column 3", "Column 4"]);
  assert.equal(guess.layout?.columns.accountIban, 3); // the same IBAN in every row: the account's own
  const again = engine.readBankText(text, [guess.layout!]);
  assert.deepEqual(again.transactions.map((t) => t.amount), ["-23.17", "1800.00"]);
  assert.equal(again.account?.iban, "DE53300209000000556677");
});
test("the guess says what it is unsure of and what is missing", () => {
  const unsigned = engine.guessCsvLayout(["Datum;Text;Wert in Euro", "02.02.2026;Fiktiv Markt;12,00", "03.02.2026;Fiktiv Cafe;3,50"].join("\n"));
  assert.ok(unsigned.unsure.includes("sign"));
  assert.ok(unsigned.confidence < 0.8);
  const noAmount = engine.guessCsvLayout(["Datum;Text;Notiz", "02.02.2026;Fiktiv Markt;Brot", "03.02.2026;Fiktiv Cafe;Kaffee"].join("\n"));
  assert.equal(noAmount.layout, null);
  assert.deepEqual(noAmount.missing, ["amount"]);
  assert.deepEqual(noAmount.columns.map((c) => c.kind), ["date", "text", "text"]);
  const ambiguous = engine.guessCsvLayout(["Date;Payee;Amount", "02/03/2026;A;-1,00", "02/03/2026;B;-2,00"].join("\n"));
  assert.ok(ambiguous.unsure.includes("dateFormat"));
});
test("readCsv refuses a file whose header does not match the layout", () => {
  const guess = engine.guessCsvLayout(unknownCsv(ROWS));
  assert.throws(() => engine.readCsv("Other;Header;Row\n01.02.2026;x;1,00\n", guess.layout!), { code: "headerMismatch" });
});

// ── Fixtures: every file has its stored answer, in Node and in the bundle, in UTF-8 and Windows-1252 ────────

for (const name of await bankFixtures()) {
  test(`fixture ${name}: the stored answer, in Node and in the bundled engine`, async () => {
    const expected = JSON.parse(await readFile(new URL(`fixtures/banks/${name}.expected.json`, import.meta.url), "utf8"));
    assert.deepEqual(await fixtureAnswer(name), expected);
    const bytes = new Uint8Array(await fixture(name));
    if (!("error" in expected)) assert.deepEqual(json(bundled.readBankFile(bytes)), expected);
    // The same file as a Windows-1252 export reads the same (where all its characters exist in Windows-1252).
    const win = windows1252(Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/, ""));
    if (win && !("error" in expected) && /[^\x00-\x7f]/.test(Buffer.from(bytes).toString("utf8")) && !name.endsWith(".xml")) {
      assert.deepEqual({ ...json(engine.readBankFile(win)), encoding: "utf-8" }, expected);
    }
  });
}

test("every known bank layout has a fixture, read as that bank (variants too), and names its sources", async () => {
  const names = await bankFixtures();
  const ids = new Set(engine.BANK_PROFILES.map((p) => p.id));
  assert.equal(ids.size, engine.BANK_PROFILES.length, "profile ids repeat");
  for (const profile of engine.BANK_PROFILES) {
    assert.ok(profile.sources.length > 0, `${profile.id} names no source`);
    assert.ok(names.includes(`${profile.id}.csv`), `no fixture for ${profile.id}`);
  }
  // <profile>.csv and <profile>.<variant>.csv
  for (const name of names.filter((n) => ids.has(n.split(".")[0]))) {
    const id = name.split(".")[0];
    const file = engine.readBankFile(await fixture(name));
    assert.equal(file.bank?.id, id, `${name} was read as ${file.bank?.id ?? "unknown"}`);
    assert.ok(file.transactions.length >= 2, `${name}: ${file.transactions.length} payments`);
    assert.equal(new Set(file.transactions.map((t) => t.externalId)).size, file.transactions.length, `${name}: ids repeat`);
    assert.ok(file.transactions.every((t) => /^-?\d+\.\d{2,}$/.test(t.amount)), `${name}: amounts`);
  }
});
