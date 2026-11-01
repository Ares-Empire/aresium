import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BANK_PROFILES, decodeBankFile, detectBankFile, guessCsvLayout, readBankText, readCsv, readingsOfUnknownFile } from "./index.js";
import { detectSeparator, splitCsv, type Separator } from "./readers/csv.js";
import { decodeBankFileWithEncoding } from "./readers/decode.js";

const fixture = async (name: string) => decodeBankFile(await readFile(new URL(`fixtures/banks/${name}`, import.meta.url)));
const csv = (rows: string[][], separator: Separator = ";") => rows
  .map((row) => row.map((v) => `"${v.replace(/"/g, '""')}"`).join(separator)).join("\n");

test("a spreadsheet separator change keeps every known bank's reading and payment ids", async () => {
  for (const profile of BANK_PROFILES) {
    const text = await fixture(`${profile.id}.csv`);
    const original = readBankText(text);
    const rows = splitCsv(text, detectSeparator(text));
    for (const separator of [";", ",", "\t"] as const) {
      const changed = readBankText(csv(rows, separator));
      assert.deepEqual(changed.transactions, original.transactions, `${profile.id}, ${JSON.stringify(separator)}`);
      assert.deepEqual(changed.account, original.account, profile.id);
      assert.deepEqual(changed.bank, original.bank, profile.id);
    }
  }
});

test("VR Bank date and separator rewrites retain legacy ids, including repetitions and text spacing", async () => {
  const text = (await fixture("volksbank.csv")).replace("Gehalt Februar 2026", "Gehalt  Februar 2026");
  const ids = readBankText(text).transactions.map((t) => t.externalId);
  const iso = text.replace(/\b(\d{2})\.(\d{2})\.(\d{4})\b/g, "$3-$2-$1");
  assert.deepEqual(readBankText(iso).transactions.map((t) => t.externalId), ids);
  const slash = text.replace(/\b(\d{2})\.(\d{2})\.(\d{4})\b/g, "$2/$1/$3");
  const request = readBankText(slash).needsLayout!;
  assert.equal(request.layout?.idStyle, "vrbank");
  const first = readingsOfUnknownFile(Buffer.from(slash))[0];
  const confirmed = readBankText(slash, [JSON.parse(JSON.stringify(first.layout))]);
  assert.deepEqual(confirmed.transactions.map((t) => t.externalId), ids);
  assert.deepEqual(confirmed.transactions.slice(0, 5), first.preview);
  assert.deepEqual(readCsv(slash, first.layout).transactions, confirmed.transactions);
  // Already saved layouts without the new opt-in retain their generic hash formula.
  const { idStyle, ...oldLayout } = first.layout;
  assert.notDeepEqual(readCsv(slash, oldLayout).transactions.map((t) => t.externalId), ids);
});

test("VR Bank skips an invalid minority row with a warning, never invoking the legacy date fallback", async () => {
  const text = await fixture("volksbank.csv");
  const rows = splitCsv(text.replace(/^\uFEFF/, ""), ";");
  const detection = detectBankFile(text);
  assert.ok(detection.format === "csv" && detection.layout);
  const c = detection.layout.columns;
  for (const invalid of ["date", "amount"] as const) {
    const broken = [...rows[1]];
    broken[c[invalid]!] = invalid === "date" ? "2026-02-30" : "not-an-amount";
    const file = readBankText(csv([...rows, broken]));
    assert.equal(file.skipped, 1);
    assert.deepEqual(file.transactions, readBankText(text).transactions);
  }
});

test("Latin-15's euro selects its decoding table without changing UTF-8 or Windows-1252", () => {
  const bytes = new Uint8Array([0xd6, 0x6c, 0x20, 0x31, 0x32, 0x20, 0xa4, 0x20, 0xa6, 0xa8, 0xb4, 0xb8, 0xbc, 0xbd, 0xbe]);
  assert.deepEqual(decodeBankFileWithEncoding(bytes), { text: "Öl 12 € ŠšŽžŒœŸ", encoding: "iso-8859-15" });
  assert.deepEqual(decodeBankFileWithEncoding(new Uint8Array([0xd6, 0x6c, 0x20, 0x80, 0x20, 0xa4])),
    { text: "Öl € ¤", encoding: "windows-1252" });
  assert.deepEqual(decodeBankFileWithEncoding(Buffer.from("Öl ¤")), { text: "Öl ¤", encoding: "utf-8" });
});

test("several payment sections or account IBANs refuse, including sections beyond the preview", async () => {
  const sections = "Account;Fictional account A\nBuchungstag;Empfänger;Verwendungszweck;Betrag\n14.10.2026;Fiktiv Laden;Einkauf;-12,00\n"
    + "Account;Fictional account B\nBuchungstag;Empfänger;Verwendungszweck;Betrag\n15.10.2026;Fiktiv Laden;Einkauf;-23,00\n";
  assert.throws(() => readBankText(sections), { code: "unknown" });
  const text = await fixture("volksbank.csv");
  const detection = detectBankFile(text);
  assert.ok(detection.format === "csv" && detection.layout);
  const rows = splitCsv(text.replace(/^\uFEFF/, ""), detection.separator);
  const second = [...rows[1]];
  second[detection.layout.columns.accountIban!] = "DE34701500000000246810";
  assert.throws(() => readBankText(csv([rows[0], ...Array.from({ length: 65 }, () => rows[1]), second])), { code: "unknown" });
  const c24 = splitCsv(await fixture("c24.csv"), ",");
  const other = [...c24[1]];
  other[c24[0].indexOf("Kontoname")] = "Fictional second account";
  assert.throws(() => readBankText(csv([c24[0], c24[1], other], ",")), { code: "unknown" });
});

test("the first guessed reading uses the purpose column rather than the booking type", () => {
  for (const type of ["Lastschrift", "Überweisung", "Kartenverfügung"]) {
    const text = csv([
      ["Datum", "Empfänger", "Umsatzart", "Buchungstext", "Betrag"],
      ["14.10.2026", "Fiktiv Laden", type, "Invented purpose that sorting needs", "-12,00"],
      ["15.10.2026", "Fiktiv Café", type, "Another invented payment purpose", "-3,50"],
    ]);
    const guess = guessCsvLayout(text);
    assert.deepEqual(guess.layout?.columns.text, [3]);
    assert.equal(guess.layout?.columns.kind, 2);
    assert.equal(guess.preview[0].description, "Invented purpose that sorting needs");
    assert.equal(readingsOfUnknownFile(Buffer.from(text))[0].preview[0].description, guess.preview[0].description);
  }
});

test("planning tables and unresolved currency labels refuse instead of proposing invented bookings", () => {
  assert.throws(() => readBankText("Budget date;Budget category;Planned amount;Forecast\n14.10.2026;Food;250,00;Plan only"), { code: "noTable" });
  assert.throws(() => readBankText("Buchungstag;Empfänger;Verwendungszweck;Betrag (EUR/USD)\n14.10.2026;Fiktiv Laden;Einkauf;-12,00"), { code: "unknown" });
  assert.equal(guessCsvLayout("Date;Payee;Amount (USD)\n2026-10-14;Fiktiv Laden;-12.00").preview[0].currency, "USD");
});

test("damaged CSVs refuse through both automatic and confirmed reading paths", async () => {
  for (const name of ["n26", "sparkasse-camt", "volksbank"]) {
    const text = await fixture(`${name}.csv`);
    const detection = detectBankFile(text);
    assert.ok(detection.format === "csv" && detection.layout);
    const rows = splitCsv(text.replace(/^\uFEFF/, ""), detection.separator);
    const header = detection.headerRow;
    const data = rows.slice(header + 1).filter((r) => /2026|\.26/.test(r[detection.layout!.columns.date] ?? ""));
    const damaged = [
      csv([rows[header], ...data.slice(0, 2), data.at(-1)!.slice(0, 6)], detection.separator),
      csv([rows[header], data[0]], detection.separator) + '\n"never closed',
      csv([rows[header], data[0]], detection.separator) + '\n"closed"junk',
    ];
    for (const broken of damaged) {
      assert.throws(() => readBankText(broken), { code: "unknown" }, name);
      assert.throws(() => readCsv(broken, detection.layout!), { code: "unknown" }, name);
    }
    assert.doesNotThrow(() => readBankText(csv([rows[header], ...data], detection.separator)), `${name}: no final newline`);
  }
});

test("empty or mostly unreadable tables refuse instead of succeeding with a fraction of the payments", async () => {
  for (const name of ["n26", "volksbank", "comdirect"]) {
    const text = await fixture(`${name}.csv`);
    const detection = detectBankFile(text);
    assert.ok(detection.format === "csv" && detection.layout);
    const layout = detection.layout;
    const rows = splitCsv(text.replace(/^\uFEFF/, ""), detectSeparator(text));
    const header = detection.headerRow;
    assert.throws(() => readBankText(csv(rows.slice(0, header + 1), detectSeparator(text))), { code: "noTable" }, name);
    const good = rows.find((r) => /2026/.test(r[layout.columns.date] ?? ""))!;
    const invalid = [...good];
    invalid[layout.columns.date] = "2026-02-30";
    const mostly = csv([layout.header, good, invalid, invalid, invalid], layout.separator);
    assert.throws(() => readBankText(mostly), { code: "unknown" }, name);
    assert.throws(() => readCsv(mostly, layout), { code: "unknown" }, `${name}: confirmed layout`);
    const mostlyShort = csv([layout.header, good, ["unreadable"], ["unreadable"], ["unreadable"]], layout.separator);
    assert.throws(() => readBankText(mostlyShort), { code: "unknown" }, `${name}: short unreadable rows`);
  }
});

test("known banks accept short and ISO dates without changing ids", async () => {
  for (const name of ["dkb", "comdirect", "consorsbank", "revolut", "n26"]) {
    const text = await fixture(`${name}.csv`);
    const original = readBankText(text);
    for (const style of ["short", "iso"] as const) {
      const rewritten = text.replace(/\b(\d{2})\.(\d{2})\.(\d{4})\b/g,
        (_, d, m, y) => style === "short" ? `${d}.${m}.${y.slice(2)}` : `${y}-${m}-${d}`)
        .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g,
          (v, y, m, d) => style === "short" ? `${d}.${m}.${y.slice(2)}` : v);
      const changed = readBankText(rewritten);
      assert.deepEqual(changed.transactions.map(({ raw, ...t }) => t), original.transactions.map(({ raw, ...t }) => t), `${name} ${style}`);
    }
  }
});

test("rewritten ambiguous dates ask for both readings while keeping the known bank's layout", async () => {
  const original = await fixture("comdirect.csv");
  const text = original.replace(/\b(\d{2})\.(\d{2})\.(\d{4})\b/g, "$2/$1/$3");
  const file = readBankText(text);
  assert.equal(file.transactions.length, 0);
  assert.ok(file.needsLayout?.unsure.includes("dateFormat"));
  assert.equal(file.needsLayout?.layout?.profile, "comdirect");
  const readings = readingsOfUnknownFile(Buffer.from(text));
  assert.deepEqual(readings.map((r) => r.layout.dateFormat), ["MM/DD/YYYY", "DD/MM/YYYY"]);
  for (const reading of readings) {
    const confirmed = readBankText(text, [reading.layout]);
    assert.deepEqual(confirmed.transactions.slice(0, 5), reading.preview);
    assert.equal(confirmed.transactions.length, 3);
    assert.equal(confirmed.transactions[0].description, "Abschlag Strom Februar");
  }
});

test("a date beyond the old sample settles the whole column's day/month order", async () => {
  const original = await fixture("consorsbank.csv");
  const rows = splitCsv(original, ";");
  const header = rows.findIndex((r) => r.some((v) => v.trim() === "Buchung"));
  const source = rows[header + 1];
  const date = rows[header].findIndex((v) => v.trim() === "Buchung");
  for (const monthFirst of [false, true]) {
    const data = Array.from({ length: 1200 }, (_, i) => {
      const row = [...source];
      row[6] = "Invented long payment purpose ".repeat(10);
      row[date] = monthFirst ? `02/${i === 1199 ? "14" : "03"}/2026` : `${i === 1199 ? "14" : "03"}/02/2026`;
      return row;
    });
    const text = csv([rows[header], ...data]);
    assert.ok(text.lastIndexOf(monthFirst ? "02/14/2026" : "14/02/2026") > 200000);
    const file = readBankText(text);
    assert.equal(file.needsLayout, undefined);
    assert.equal(file.transactions.length, 1200);
    assert.equal(file.transactions.at(-1)?.bookingDate.slice(0, 10), "2026-02-14");
  }
});

test("PayPal separator changes keep transaction ids and damaged or empty tables refuse", async () => {
  const text = await fixture("paypal-activity-en.csv");
  const original = readBankText(text);
  const rows = splitCsv(text, ",");
  for (const separator of [";", ",", "\t"] as const) {
    assert.deepEqual(readBankText(csv(rows, separator)).transactions, original.transactions);
  }
  assert.throws(() => readBankText(csv([rows[0]], ",")), { code: "noTable" });
  assert.throws(() => readBankText(csv([rows[0], rows[1], rows[2].slice(0, 3)], ",")), { code: "unknown" });
});

test("conflicting date orders refuse instead of offering readings that lose payments", async () => {
  const text = await fixture("comdirect.csv");
  const rows = splitCsv(text, ";");
  const detection = detectBankFile(text);
  assert.ok(detection.format === "csv" && detection.layout);
  const first = [...rows[detection.headerRow + 2]], second = [...first];
  first[detection.layout.columns.date] = "14/02/2026";
  second[detection.layout.columns.date] = "02/15/2026";
  assert.throws(() => readBankText(csv([rows[detection.headerRow], first, second])), { code: "unknown" });
});
