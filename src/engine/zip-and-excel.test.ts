import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { parse } from "csv-parse/sync";
import { strFromU8, strToU8, unzipSync, zipSync, Zip, ZipDeflate } from "fflate";
import { bundleEngine } from "../../scripts/build-engine.js";
import { bankCamt, bankWorkbook, bankZip, encryptedZip, zipPayments, type ExcelCell } from "../../eval/files/make-containers.js";
import * as engine from "./index.js";
import { excelDecimal } from "./readers/xlsx.js";

const context = createContext({});
runInContext(await bundleEngine(), context);
const bundled = context.AresiumEngine as typeof engine;
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
const engines = [engine, bundled];
const cases = new URL("../../eval/files/cases/", import.meta.url);
for (const name of (await readdir(cases)).filter((n) => /^(zip-|xlsx-|old-excel)/.test(n) && n.endsWith(".case.json"))) {
  test(`${name}: source and bundle agree on payments, ids and refusal`, async () => {
    const spec = JSON.parse(await readFile(new URL(name, cases), "utf8"));
    const bytes = await readFile(new URL(spec.file, cases));
    for (const reader of engines) {
      if (spec.expected.outcome === "refuse") { assert.throws(() => reader.readBankFile(bytes), { code: spec.expected.code }); continue; }
      let file = reader.readBankFile(bytes);
      let saved: engine.CsvLayout[] = [];
      if (file.needsLayout) {
        assert.equal(file.transactions.length, 0);
        const readings = reader.readingsOfUnknownFile(bytes);
        assert.ok(readings.length);
        assert.ok(file.needsLayout.layout);
        saved = [file.needsLayout.layout];
        file = reader.readBankFile(bytes, saved);
        assert.deepEqual(json(readings[0].preview), json(file.transactions.slice(0, 5)));
      }
      const payments = file.transactions.map((t) => ({ date: t.bookingDate.slice(0, 10), amountCents: Math.round(Number(t.amount) * 100),
        currency: t.currency, counterparty: t.counterparty ?? null, text: t.description }));
      const order = (v: unknown[]) => v.map((p) => JSON.stringify(p)).sort();
      assert.deepEqual(json(order(payments)), order(spec.expected.payments));
      if (spec.reimport) assert.deepEqual(json(file.transactions.map((t) => t.externalId).sort()), [...spec.reimport.originalIds].sort());
      assert.deepEqual(json(file), json(reader === engine ? bundled.readBankFile(bytes, saved) : engine.readBankFile(bytes, saved)));
    }
  });
}

test("ZIP CAMT members retain exactly the standalone ids and are ordered by booking date", () => {
  const bytes = bankZip({ "late.xml": bankCamt([2]), "early.xml": bankCamt([0, 1]), "report.xml": bankCamt([1], undefined, true) });
  for (const reader of engines) {
    const result = reader.readBankFile(bytes);
    assert.deepEqual(json(result.transactions.map((t) => t.externalId)), ["ZIP-FICTION-1", "ZIP-FICTION-2", "ZIP-FICTION-3"]);
    for (let i = 0; i < 3; i++) assert.deepEqual(json(result.transactions[i]), json(reader.readBankText(bankCamt([i])).transactions[0]));
    assert.deepEqual(json(reader.readBankFile(bankZip({ "only.xml": bankCamt([2, 0, 1]) })).transactions.map((t) => t.bookingDate.slice(0, 10))), zipPayments.map((p) => p.date));
  }
});

test("ZIP recognises MT940, CSV contents without suffixes, and keeps skipped-row warnings", async () => {
  const source = await readFile(new URL("fixtures/banks/sparkasse-camt.csv", import.meta.url));
  for (const reader of engines) {
    const file = reader.readBankFile(bankZip({ "export": source }));
    const original = reader.readBankFile(source);
    assert.equal(file.skipped, original.skipped);
    assert.deepEqual(file.transactions.map((t) => t.externalId).sort(), original.transactions.map((t) => t.externalId).sort());
  }
});

test("ZIP refuses different accounts within one CAMT or MT940 member", async () => {
  const first = bankCamt([0]), other = bankCamt([1], "DE96100500000000123456");
  const secondStatement = other.match(/<Stmt>.*<\/Stmt>/)![0];
  const camt = first.replace("</BkToCstmrStmt>", secondStatement + "</BkToCstmrStmt>");
  const mt = (await readFile(new URL("fixtures/banks/mt940.sta", import.meta.url), "utf8"));
  for (const reader of engines) {
    assert.throws(() => reader.readBankFile(bankZip({ "bank.xml": camt })), { code: "zipAccounts" });
    assert.throws(() => reader.readBankFile(bankZip({ "bank.sta": mt + "\n" + mt.replace(/:25:[^\n]+/, ":25:99999999/0000000001") })), { code: "zipAccounts" });
  }
});

test("ZIP refuses unidentifiable account combinations and conflicting repeated bank references", () => {
  const unknown = "Booking Date;Payee;Amount\n2026-10-14;Fiktiv Markt;-12.30\n";
  for (const reader of engines) {
    assert.throws(() => reader.readBankFile(bankZip({ "a.csv": unknown, "b.csv": unknown })), { code: "zipLayout" });
    const conflict = bankCamt([0]).replace("12.30", "42.00");
    assert.throws(() => reader.readBankFile(bankZip({ "a.xml": bankCamt([0]), "b.xml": conflict })), { code: "unknown" });
  }
});

test("one unknown CSV in a ZIP supports column confirmation and alternate readings", () => {
  const bytes = bankZip({ "bank.csv": "Booking Date;Payee;Description;Amount\n2026-10-14;Fiktiv Markt;Purchase;-12.30\n" });
  for (const reader of engines) {
    const first = reader.readBankFile(bytes);
    assert.ok(first.needsLayout?.layout);
    assert.equal(first.transactions.length, 0);
    const readings = reader.readingsOfUnknownFile(bytes);
    assert.ok(readings.length);
    const confirmed = reader.readBankFile(bytes, [readings[0].layout]);
    assert.deepEqual(json(confirmed.transactions), json(readings[0].preview));
  }
});

test("ZIP checks encryption flags in both directory and local headers, including ignored entries", () => {
  for (const reader of engines) for (const [local, central] of [[true, false], [false, true], [true, true]]) {
    assert.throws(() => reader.readBankFile(encryptedZip(bankZip({ "__MACOSX/ignored": "x" }), local, central)), { code: "zipEncrypted" });
  }
});

test("ZIP rejects corrupt CRCs, truncated archives and false unpacked sizes before importing", () => {
  const good = bankZip({ "bank.xml": bankCamt([0]) });
  const wrongCrc = Buffer.from(good);
  const central = wrongCrc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  wrongCrc.writeUInt32LE(123, 14); wrongCrc.writeUInt32LE(123, central + 16);
  const wrongSize = Buffer.from(good);
  wrongSize.writeUInt32LE(1, 22); wrongSize.writeUInt32LE(1, central + 24);
  for (const reader of engines) for (const bytes of [wrongCrc, wrongSize, good.subarray(0, -1)]) {
    assert.throws(() => reader.readBankFile(bytes), { code: "zip" });
  }
});

test("ZIP size limit covers the sum of entries, including hidden files", () => {
  const bytes = bankZip({ ".hidden": new Uint8Array(26 * 1024 * 1024), "bank.csv": new Uint8Array(25 * 1024 * 1024) });
  for (const reader of engines) assert.throws(() => reader.readBankFile(bytes), { code: "zipLimit" });
});

test("ZIP stored members and streaming data descriptors are supported", () => {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((error, data) => { if (error) throw error; chunks.push(data); });
  const member = new ZipDeflate("bank.xml");
  zip.add(member); member.push(strToU8(bankCamt([0])), true); zip.end();
  const bytes = Buffer.concat(chunks);
  const stored = zipSync({ "empty.txt": new Uint8Array(), "bank.xml": strToU8(bankCamt([0])) }, { level: 0 });
  for (const reader of engines) {
    assert.equal(reader.readBankFile(bytes).transactions[0].externalId, "ZIP-FICTION-1");
    assert.equal(reader.readBankFile(stored).transactions[0].externalId, "ZIP-FICTION-1");
  }
});

const unknownRows = (): ExcelCell[][] => [["Booking Date", "Payee", "Description", "Amount", "Currency"],
  [{ type: "date", value: "2026-10-14" }, "Fiktiv Markt", "Öl & Süßwaren <receipt>", { type: "number", value: "-1.23E1", style: 0 }, "EUR"]];
function editWorkbook(bytes: Uint8Array, path: string, change: (xml: string) => string): Buffer {
  const files = unzipSync(bytes);
  files[path] = strToU8(change(strFromU8(files[path])));
  return bankZip(files);
}

test("Excel expands numeric exponents exactly without rounding or float noise", () => {
  for (const [raw, want] of [["-12.3", "-12.30"], ["1.23e3", "1230.00"], ["-1.23e-2", "-0.0123"], ["-0", "0.00"],
    ["9007199254740993.01", "9007199254740993.01"], ["1.2300000000000001", "1.2300000000000001"]]) assert.equal(excelDecimal(raw, true), want);
});

test("Excel General-format amounts, sparse cells, rich shared/inline strings and both date systems", () => {
  for (const mac of [false, true]) for (const reader of engines) {
    const bytes = bankWorkbook(unknownRows(), mac, true);
    const first = reader.readBankFile(bytes);
    assert.equal(first.transactions.length, 0);
    const layout = first.needsLayout!.layout!;
    const file = reader.readBankFile(bytes, [layout]);
    assert.equal(file.transactions[0].bookingDate, "2026-10-14T00:00:00.000Z");
    assert.equal(file.transactions[0].amount, "-12.30");
    assert.equal(file.transactions[0].description, "Öl & Süßwaren <receipt>");
    assert.equal(file.transactions[0].counterparty, "Fiktiv Markt");
  }
});

test("Excel rejects formulas, bad shared strings, external worksheets and malformed XML", () => {
  const bytes = bankWorkbook(unknownRows());
  const invalid = [
    editWorkbook(bytes, "xl/worksheets/bookings.xml", (x) => x.replace('<v>-1.23E1</v>', '<f>SUM(A1)</f><v>-1.23E1</v>')),
    editWorkbook(bytes, "xl/worksheets/bookings.xml", (x) => x.replace('t="s"><v>0</v>', 't="s"><v>99999</v>')),
    editWorkbook(bytes, "xl/_rels/workbook.xml.rels", (x) => x.replace('Id="bookings"', 'Id="bookings" TargetMode="External"')),
    editWorkbook(bytes, "xl/worksheets/bookings.xml", (x) => x.slice(0, -4)),
    editWorkbook(bytes, "xl/worksheets/bookings.xml", (x) => '<!DOCTYPE worksheet [<!ENTITY x "x">]>' + x),
  ];
  for (const reader of engines) for (const bytes of invalid) assert.throws(() => reader.readBankFile(bytes), { code: "xlsx" });
});

test("Excel rejects the fictitious 1900 leap day and impossible sparse coordinates", () => {
  const bytes = bankWorkbook(unknownRows());
  for (const reader of engines) for (const changed of [
    editWorkbook(bytes, "xl/worksheets/bookings.xml", (x) => x.replace(/(<c r="A2"[^>]*><v>)[^<]+/, "$1" + "60")),
    editWorkbook(bytes, "xl/worksheets/bookings.xml", (x) => x.replace('r="E2"', 'r="XFE2"')),
  ]) assert.throws(() => reader.readBankFile(changed), { code: "xlsx" });
});


test("Excel preserves normal two-decimal VR ids and exposes the legacy lexical-amount limitation", async () => {
  const source = await readFile(new URL("fixtures/banks/volksbank.csv", import.meta.url), "utf8");
  const rows = parse(source, { delimiter: ";", bom: true }) as string[][];
  // The ordinary bank convention is two decimals; the frozen fixture deliberately also has 1800 and -3,2.
  const normal = rows.map((row, i) => row.map((v, c) => i > 0 && c === 11 ? Number(v.replace(",", ".")).toFixed(2).replace(".", ",") : v));
  const csv = normal.map((r) => r.map((v) => `"${v.replace(/"/g, '\"\"')}"`).join(";")).join("\n");
  const workbook = bankWorkbook(normal.map((r, i) => r.map((v, c): ExcelCell => {
    if (i > 0 && (c === 4 || c === 5)) { const [d, m, y] = v.split("."); return { type: "date", value: `${y}-${m}-${d}` }; }
    if (i > 0 && c === 11) return { type: "number", value: String(Number(v.replace(",", "."))) };
    return v;
  })));
  for (const reader of engines) {
    const originalIds = reader.readBankText(source).transactions.map((t) => t.externalId);
    const normalIds = reader.readBankText(csv).transactions.map((t) => t.externalId);
    const excelIds = reader.readBankFile(workbook).transactions.map((t) => t.externalId);
    assert.deepEqual(json(excelIds), json(normalIds));
    assert.equal(excelIds.filter((id, i) => id !== originalIds[i]).length, 3);
  }
});


test("ZIP supports legacy filename bytes and reports damaged UTF-8 names with a bank error code", () => {
  const legacy = bankZip({ "bank.xml": bankCamt([0]) });
  const central = legacy.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  legacy[30] = 0x84; legacy[central + 46] = 0x84;
  const invalidUtf8 = Buffer.from(legacy);
  invalidUtf8[7] |= 8; invalidUtf8[central + 9] |= 8;
  for (const reader of engines) {
    assert.equal(reader.readBankFile(legacy).transactions[0].externalId, "ZIP-FICTION-1");
    assert.throws(() => reader.readBankFile(invalidUtf8), { code: "zip" });
  }
});

test("Excel bounds the materialized grid even when sparse XML contains very few cells", () => {
  const bytes = editWorkbook(bankWorkbook(unknownRows()), "xl/worksheets/bookings.xml", (x) => x.replace("</sheetData>",
    Array.from({ length: 63 }, (_, i) => `<row r="${i + 3}"><c r="XFD${i + 3}" t="b"><v>1</v></c></row>`).join("") + "</sheetData>"));
  for (const reader of engines) assert.throws(() => reader.readBankFile(bytes), { code: "xlsx" });
});
