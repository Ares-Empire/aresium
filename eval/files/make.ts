// This generator must not import the engine or run a reader. Answers are copied from frozen originals,
// written before serializing invented rows, or explicitly specified by hand.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "csv-parse/sync";
import { cents, type FileCase, type Payment } from "./types.js";

export const DEFAULT_SEED = 78;
const fixtures = fileURLToPath(new URL("../../src/engine/fixtures/banks/", import.meta.url));
type Encoding = "utf8" | "utf8-bom" | "windows1252" | "latin1" | "latin15" | "utf16le";
const encodings: Encoding[] = ["utf8", "utf8-bom", "windows1252", "latin1", "latin15", "utf16le"];
const winHigh = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
const latin15 = new Map([["€", 0xa4], ["Š", 0xa6], ["š", 0xa8], ["Ž", 0xb4], ["ž", 0xb8], ["Œ", 0xbc], ["œ", 0xbd], ["Ÿ", 0xbe]]);

export function encode(text: string, encoding: Encoding): Buffer {
  if (encoding === "utf8") return Buffer.from(text, "utf8");
  if (encoding === "utf8-bom") return Buffer.from("\uFEFF" + text, "utf8");
  if (encoding === "utf16le") return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const win = winHigh.indexOf(ch);
    const code = encoding === "windows1252" && win >= 0 ? 0x80 + win : encoding === "latin15" && latin15.has(ch) ? latin15.get(ch)! : cp;
    if (code > 255 || (encoding === "latin15" && [...latin15.values()].includes(cp) && !latin15.has(ch))) {
      throw new Error(`${JSON.stringify(ch)} cannot be represented in ${encoding}`);
    }
    bytes.push(code);
  }
  return Buffer.from(bytes);
}

// Native decoding here is independent of the engine decoder being evaluated.
function decodeOriginal(bytes: Buffer): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("windows-1252").decode(bytes); }
}

export function csv(rows: string[][], separator = ";", quoteAll = false, ending = "\n", final = true): string {
  return rows.map((row) => row.map((cell) => quoteAll || cell.includes(separator) || /["\r\n]/.test(cell)
    ? `"${cell.replace(/"/g, '""')}"` : cell).join(separator)).join(ending) + (final ? ending : "");
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

type Original = {
  bank?: { id: string };
  transactions: { bookingDate: string; amount: string; currency: string; counterparty?: string | null; description: string; externalId: string }[];
  layout?: { separator: string; numberFormat: "de" | "en"; columns: Record<string, number | number[]> };
};
function originalPayments(answer: Original): Payment[] {
  return answer.transactions.map((t) => {
    const amountCents = cents(t.amount);
    if (amountCents === null) throw new Error(`Non-cent fixture amount: ${t.amount}`);
    return { date: t.bookingDate.slice(0, 10), amountCents, currency: t.currency, counterparty: t.counterparty ?? null, text: t.description };
  });
}

// Spreadsheet rewrites operate on the source cells, with independent decimal/date syntax, never inferred
// answers. The expected fixture layout only identifies columns and the original decimal convention.
function dateParts(value: string): [string, string, string, string] | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(value);
  if (m) return [m[1], m[2], m[3], m[4]];
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(value);
  return m ? [m[3].length === 2 ? "20" + m[3] : m[3], m[2].padStart(2, "0"), m[1].padStart(2, "0"), ""] : null;
}
function dateCell(value: string, style: "short" | "iso" | "us"): string {
  const p = dateParts(value);
  if (!p) return value;
  const [y, m, d, suffix] = p;
  return (style === "short" ? `${d}.${m}.${y.slice(2)}` : style === "iso" ? `${y}-${m}-${d}` : `${m}/${d}/${y}`) + suffix;
}
function numberCell(value: string, from: "de" | "en", to: "de-plain" | "en-plain" | "en-grouped"): string {
  if (!value.trim()) return value;
  const compact = value.trim().replace(/\s*(EUR|€)\s*/g, "");
  const canonical = from === "de" ? compact.replace(/\./g, "").replace(",", ".") : compact.replace(/,/g, "");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(canonical)) throw new Error(`Unexpected original number ${value}`);
  let [whole, fraction = ""] = canonical.split(".");
  fraction = fraction.padEnd(2, "0");
  if (to === "en-grouped") whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return whole + (to === "de-plain" ? "," : ".") + fraction;
}

// A tiny stored ZIP writer makes an actual minimal XLSX, rather than a text stand-in for binary input.
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function xlsx(): Buffer {
  const entries = [
    ["[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ["_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ["xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Fictional" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ["xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ["xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Fictional budget</t></is></c></row></sheetData></worksheet>'],
  ];
  const locals: Buffer[] = [], directories: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const n = Buffer.from(name), b = Buffer.from(content), crc = crc32(b);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(b.length, 18); h.writeUInt32LE(b.length, 22); h.writeUInt16LE(n.length, 26);
    const d = Buffer.alloc(46);
    d.writeUInt32LE(0x02014b50); d.writeUInt16LE(20, 4); d.writeUInt16LE(20, 6); d.writeUInt32LE(crc, 16);
    d.writeUInt32LE(b.length, 20); d.writeUInt32LE(b.length, 24); d.writeUInt16LE(n.length, 28); d.writeUInt32LE(offset, 42);
    locals.push(h, n, b); directories.push(d, n); offset += h.length + n.length + b.length;
  }
  const central = Buffer.concat(directories), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
function pdf(): Buffer {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>", "<< /Length 0 >>\nstream\n\nendstream"];
  let result = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(result)); result += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}

export async function makeCases(folder: string, seed = DEFAULT_SEED): Promise<number> {
  const rng = random(seed);
  const generated = new Map<string, { bytes: Buffer; spec: FileCase }>();
  type Details = Omit<FileCase, "version" | "file" | "seed">;
  const add = (name: string, data: string | Buffer, details: Details, extension = "csv") => {
    if (generated.has(name)) throw new Error(`Duplicate case ${name}`);
    generated.set(name, { bytes: typeof data === "string" ? Buffer.from(data) : data,
      spec: { version: 1, file: `${name}.${extension}`, seed, ...details } });
  };
  const names = (await readdir(fixtures)).filter((n) => /\.(csv|xml|sta)$/.test(n) && !n.startsWith("unknown-") && n !== "comdirect.sections.csv").sort();
  for (const [i, name] of names.entries()) {
    const reference = `${name}.expected.json`, rawAnswer = await readFile(resolve(fixtures, reference));
    const answer = JSON.parse(rawAnswer.toString()) as Original;
    const text = decodeOriginal(await readFile(resolve(fixtures, name))).replace(/^\uFEFF/, "");
    const bank = answer.bank?.id ?? (name.endsWith(".sta") ? "mt940" : "camt");
    const stem = name.replace(/\.(csv|xml|sta)$/, ""), extension = name.split(".").at(-1)!;
    const base: Details = { bank, kind: "", situation: "", change: "", provenance: { method: "original", fixture: name, reference,
      sha256: createHash("sha256").update(rawAnswer).digest("hex") },
    expected: { outcome: "read", payments: originalPayments(answer) }, reimport: { originalIds: answer.transactions.map((t) => t.externalId) } };
    let encoding = encodings[i % encodings.length];
    const ending = ["\n", "\r\n", "\r"][Math.floor(i / encodings.length) % 3];
    let content = text.replace(/\r\n|\r|\n/g, ending);
    // A truthful XML declaration accompanies a byte encoding change.
    const declaration = (e: Encoding) => e === "utf16le" ? "UTF-16" : e === "latin1" ? "ISO-8859-1" : e === "latin15" ? "ISO-8859-15" : e === "windows1252" ? "Windows-1252" : "UTF-8";
    const encoded = (e: Encoding) => encode(content.replace(/encoding="[^"]+"/, `encoding="${declaration(e)}"`), e);
    let bytes: Buffer;
    try { bytes = encoded(encoding); }
    catch { encoding = "utf8-bom"; bytes = encoded(encoding); }
    add(`${stem}--encoding`, bytes, { ...base, kind: `encoding-${encoding}`, situation: "A bank download or spreadsheet uses a different text encoding and line ending.",
      change: `${encoding}; ${JSON.stringify(ending)} record endings; unchanged cells.` }, extension);

    if (extension !== "csv") {
      add(`${stem}--line-crlf`, text.replace(/\r\n|\r|\n/g, "\r\n"), { ...base, kind: "line-crlf", situation: "A statement is downloaded on Windows.", change: "CRLF record endings." }, extension);
      add(`${stem}--no-final-newline`, text.replace(/[\r\n]+$/, ""), { ...base, kind: "no-final-newline", situation: "A file transfer omits the final line ending.", change: "Remove only final line endings." }, extension);
      continue;
    }
    const separator = answer.layout?.separator ?? (bank === "paypal" ? "," : ";");
    const rows = parse(text, { delimiter: separator, bom: true, relax_column_count: true, skip_empty_lines: false }) as string[][];
    const operations = ["separator-comma", "separator-semicolon", "separator-tab", "quotes-all", "quotes-minimal", "trailing-columns"];
    const operation = operations[i % operations.length];
    const newSeparator = operation === "separator-comma" ? "," : operation === "separator-semicolon" ? ";" : operation === "separator-tab" ? "\t" : separator;
    add(`${stem}--spreadsheet`, csv(operation === "trailing-columns" ? rows.map((r) => [...r, "", "", ""]) : rows,
      newSeparator, operation === "quotes-all"), { ...base, kind: operation,
      situation: "Excel or Numbers saves the downloaded statement again with local CSV settings.",
      change: `${operation}; cells preserved, quotes retained wherever CSV syntax requires them.` });
    const extras = ["preamble", "empty-rows", "no-final-newline", "total-row"];
    const extra = extras[Math.floor(i / 6) % extras.length];
    const extraText = extra === "preamble" ? csv([["Account", "Fictional test account"], ["Period", "2026-02-01 to 2026-02-28"], ["Opening balance", "500,00 EUR"]], separator) + text
      : extra === "empty-rows" ? text + "\n\n\n" : extra === "total-row" ? text.replace(/[\r\n]*$/, "\n") + csv([["Total", "", "", "2.257,20 EUR"]], separator)
      : text.replace(/[\r\n]+$/, "");
    add(`${stem}--export-extra`, extraText, { ...base, kind: extra,
      situation: extra === "preamble" ? "The bank adds account, period and balance lines above its table."
        : extra === "total-row" ? "A spreadsheet appends a total below the payment table."
          : extra === "empty-rows" ? "A spreadsheet saves unused rows at the end." : "A CSV editor omits the final record ending.", change: extra });

    const excelBanks = ["sparkasse-camt.csv", "volksbank.csv", "ing.csv", "dkb.csv", "comdirect.csv", "commerzbank.csv", "consorsbank.csv", "deutsche-bank.csv", "n26.csv", "revolut.csv"];
    if (excelBanks.includes(name)) {
      const columns = answer.layout?.columns ?? { date: 4, valueDate: 5, amount: 11, balance: 13 };
      const numberColumns = [columns.amount, columns.debit, columns.credit, columns.balance,
        ...((columns.fees as number[] | undefined) ?? []), ...((columns.addAmounts as number[] | undefined) ?? [])].filter((v): v is number => typeof v === "number");
      const dateColumns = [columns.date, columns.valueDate].filter((v): v is number => typeof v === "number");
      for (const [style, numStyle] of [["short", "de-plain"], ["iso", "en-plain"], ["us", "en-grouped"]] as const) {
        const changed = rows.map((r) => {
          // Header, preamble, pending notices and totals are not date-bearing booking rows.
          if (!dateParts(r[dateColumns[0]] ?? "")) return r;
          const next = [...r];
          dateColumns.forEach((c) => { next[c] = dateCell(next[c] ?? "", style); });
          numberColumns.forEach((c) => { next[c] = numberCell(next[c] ?? "", answer.layout?.numberFormat ?? "de", numStyle); });
          return next;
        });
        add(`${stem}--excel-${style}`, csv(changed, style === "short" ? ";" : ","), { ...base, kind: `excel-${style}`,
          situation: style === "us" ? "Excel with US settings rewrites dates and thousands separators."
            : style === "iso" ? "Numbers saves ISO dates and decimal points." : "German Excel shortens years and removes thousands separators.",
          change: `${style} dates; ${numStyle} amounts; ${style === "short" ? "semicolon" : "comma"} CSV.` });
      }
    }
  }

  const freshPayments = (index: number): Payment[] => [
    { date: "2026-10-14", amountCents: -(123456 + Math.floor(rng() * 90)), currency: "EUR", counterparty: `Fiktiv Märchenmarkt ${index}`, text: "Öl, Süßwaren und Grüße" },
    { date: "2026-10-15", amountCents: -345, currency: "EUR", counterparty: `Fiktiv Café ${index}`, text: 'Beleg "Herbst"' },
    { date: "2026-10-18", amountCents: 210045, currency: "EUR", counterparty: `Fiktiv Beispielwerke ${index}`, text: "Gehalt Oktober" },
  ];
  const date = (iso: string, style: number) => {
    const [y, m, d] = iso.split("-");
    return style === 0 ? `${d}.${m}.${y}` : style === 1 ? `${d}.${m}.${y.slice(2)}` : style === 2 ? iso : `${m}/${d}/${y}`;
  };
  const money = (value: number, style: number) => {
    let whole = String(Math.trunc(Math.abs(value) / 100));
    const frac = String(Math.abs(value) % 100).padStart(2, "0");
    if (style === 0 || style === 3) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, style === 0 ? "." : ",");
    return (value < 0 ? "-" : "") + whole + (style < 2 ? "," : ".") + frac;
  };
  for (let i = 0; i < 30; i++) {
    // Rows (the oracle) exist before any header choices or serialization.
    const payments = freshPayments(i + 1);
    if (i % 7 === 0) payments[1].currency = "USD";
    const english = i >= 20, dateStyle = i % 4, moneyStyle = Math.floor(i / 4) % 4;
    const headers = english
      ? [["Booking Date", "Transaction date", "Date"][i % 3], ["Amount", "Value", "Total"][i % 3], ["Merchant", "Payee", "Name"][i % 3], ["Description", "Details", "Memo"][i % 3], "Currency"]
      : [["Buchungstag", "Valuta", "Wertstellung"][i % 3], ["Betrag", "Umsatz"][i % 2], ["Empfänger", "Auftraggeber", "Zahlungspflichtiger", "Name"][i % 4], ["Verwendungszweck", "Buchungstext", "Beschreibung"][i % 3], "Währung"];
    const order = [0, 1, 2, 3, 4]; // Fisher–Yates below is stable across JS implementations.
    for (let j = order.length - 1; j > 0; j--) { const k = Math.floor(rng() * (j + 1)); [order[j], order[k]] = [order[k], order[j]]; }
    const rows = [headers, ...payments.map((p) => [date(p.date, dateStyle), money(p.amountCents, moneyStyle), p.counterparty!, p.text, p.currency])];
    const sep = [";", ",", "\t"][i % 3];
    add(`unknown-${String(i + 1).padStart(2, "0")}`, csv(rows.map((r) => order.map((j) => r[j])), sep, i % 2 === 0), {
      bank: english ? "fictional-English" : "fictional-German", kind: "unknown-bank",
      situation: "A tester brings an export from a bank without a built-in profile.",
      change: `Invented ${english ? "English" : "German"} headers; reordered columns; date style ${dateStyle}; amount style ${moneyStyle}; currency per row.`,
      provenance: { method: "construction", reason: "Payments are generated first; headers, order and localized cells are then written from them." },
      expected: { outcome: "read", payments },
    });
  }

  // These include a euro sign only in encodings that can represent it: ISO-8859-1 has no euro code point.
  for (const encoding of encodings) {
    const payments = freshPayments(100);
    payments[0].text = `Öl und Süßwaren; Grüße ${encoding === "latin1" ? "EUR" : "€"}`;
    const rows = [["Buchungstag", "Empfänger", "Verwendungszweck", "Betrag", "Währung"],
      ...payments.map((p) => [date(p.date, 0), p.counterparty!, p.text, money(p.amountCents, 0), p.currency])];
    add(`accent-${encoding}`, encode(csv(rows, ";", true, "\r\n"), encoding), { bank: "fictional-German", kind: `encoding-${encoding}`,
      situation: "A German export contains umlauts, ß and a euro symbol after being saved in a legacy encoding.",
      change: `${encoding}, CRLF, quoted text; literal EUR for Latin-1, which cannot encode €.`,
      provenance: { method: "construction", reason: "The accented text and integer-cent payments are written before encoding their CSV." }, expected: { outcome: "read", payments } });
  }

  for (const variation of ["debit-credit", "s-h", "trailing-minus", "currency-in-cell"] as const) for (let i = 0; i < 3; i++) {
    const payments = freshPayments(200 + i);
    const header = ["Buchungstag", "Empfänger", "Verwendungszweck", ...(variation === "debit-credit" ? ["Soll", "Haben"] : variation === "s-h" ? ["Betrag", "S/H"] : ["Betrag"]), "Währung"];
    const rows = payments.map((p) => {
      const amount = money(p.amountCents, 1), abs = amount.replace(/^-/, "");
      const cells = variation === "debit-credit" ? [p.amountCents < 0 ? abs : "", p.amountCents > 0 ? abs : ""]
        : variation === "s-h" ? [abs, p.amountCents < 0 ? "S" : "H"]
          : [variation === "trailing-minus" ? abs + (p.amountCents < 0 ? "-" : "") : amount + " EUR"];
      return [date(p.date, 0), p.counterparty!, p.text, ...cells, p.currency];
    });
    add(`bank-${variation}-${i + 1}`, csv([header, ...rows], [";", ",", "\t"][i]), { bank: "fictional-German", kind: variation,
      situation: "The bank uses another convention to mark money in and money out.", change: variation,
      provenance: { method: "construction", reason: "Signed integer-cent payments exist first; sign markers and debit/credit cells encode those signs." }, expected: { outcome: "read", payments } });
  }

  // Known N26 headers exercise text handling without a guessed-layout gate.
  const n26Header = ["Booking Date", "Value Date", "Partner Name", "Partner Iban", "Type", "Payment Reference", "Account Name", "Amount (EUR)", "Original Amount", "Original Currency", "Exchange Rate"];
  for (const style of ["multiline-text", "embedded-quote", "long-text"]) {
    const payments = freshPayments(300);
    const rawText = style === "multiline-text" ? "Erste Zeile\nZweite Zeile\r\nGrüße zum Herbst" : style === "embedded-quote" ? 'Bestellung "Öl und Süßwaren", Beleg 78' : "Fiktiver langer Verwendungszweck " + "Grüße und Öl; ".repeat(1200) + "ENDE";
    payments[0].text = rawText.replace(/\s+/g, " ").trim();
    const rows = [n26Header, ...payments.map((p, i) => [p.date, p.date, p.counterparty!, "", "Transfer", i === 0 ? rawText : p.text, "Fictional account", money(p.amountCents, 2), "", "", ""])];
    add(`n26--${style}`, csv(rows, ","), { bank: "n26", kind: style, situation: "A bank purpose contains pasted line breaks, quotation marks or a very long reference.",
      change: style, provenance: { method: "construction", reason: "Invented payments are serialized under the real N26 header; expected text folds whitespace as payment text does." }, expected: { outcome: "read", payments } });
  }

  const refuse = (name: string, data: string | Buffer, code: string, reason: string, bank = "non-bank", kind = "must-refuse") => add(name, data, {
    bank, kind, situation: reason, change: name, provenance: { method: "hand", reason }, expected: { outcome: "refuse", code, reason },
  });
  refuse("refuse-empty", "", "empty", "The selected download is empty after a failed transfer.");
  refuse("refuse-whitespace", "\uFEFF\r\n \t\r\n", "empty", "A spreadsheet saved only empty cells.");
  refuse("refuse-contacts", csv([["Name", "Email", "Phone"], ["Fiktiv Kontakt", "contact@example.invalid", "0000000000"]]), "noTable", "The wrong CSV was selected: this is an address book.");
  refuse("refuse-shopping-list", csv([["Artikel", "Menge", "Preis"], ["Fiktive Äpfel", "3", "2,50"]]), "noTable", "A shopping list has prices but no bookings.");
  refuse("refuse-budget", csv([["Budget date", "Budget category", "Planned amount", "Forecast"], ["14.10.2026", "Fiktive Lebensmittel", "250,00", "Plan only"], ["15.10.2026", "Fiktive Miete", "800,00", "Plan only"]]), "noTable", "A budget plan has dates and planned amounts, but no booked payments.");
  refuse("refuse-header-only", csv([["Booking Date", "Value Date", "Partner Name", "Partner Iban", "Type", "Payment Reference", "Account Name", "Amount (EUR)"]], ","), "noTable", "A bank export contains its header but no payments.", "n26");
  refuse("refuse-unknown-header-only", "Buchungstag;Empfänger;Betrag\n", "noTable", "An unknown export contains column headings but no payment rows.");
  refuse("refuse-xlsx-renamed", xlsx(), "zip", "An actual XLSX workbook was renamed .csv instead of exported as CSV.");
  refuse("refuse-pdf-renamed", pdf(), "noTable", "A PDF statement was renamed .csv instead of converted to a table.");
  refuse("refuse-mixed-currencies", csv([["Buchungstag", "Empfänger", "Verwendungszweck", "Betrag (EUR/USD)"], ["14.10.2026", "Fiktiv Euroshop", "EUR purchase", "-12,00"], ["15.10.2026", "Fiktiv Dollarshop", "USD purchase", "-23,00"]]), "unknown", "An export mixes EUR and USD without identifying the currency per amount; it must not silently default to EUR.", "fictional-German");
  for (const source of ["n26.csv", "sparkasse-camt.csv", "volksbank.csv"]) {
    const text = decodeOriginal(await readFile(resolve(fixtures, source))).trimEnd();
    const lastLine = text.lastIndexOf("\n") + 1;
    refuse(`refuse-${source.slice(0, -4)}-cutoff`, text.slice(0, lastLine + Math.floor((text.length - lastLine) / 2)), "unknown",
      "A download ends halfway through a payment row; partial payment data must not be imported silently.", source.slice(0, -4), "cutoff");
  }
  refuse("refuse-broken-quote", csv([n26Header, ["2026-10-14", "2026-10-14", "Fiktiv Laden", "", "Transfer", "Complete row", "Test", "-12.00", "", "", ""]], ",") + '2026-10-15,2026-10-15,"Fiktiv broken merchant,,Transfer,Unclosed quote,Test,-23.00,,,', "unknown", "A damaged quoted field runs to the end of the download; the file must be refused.", "n26", "broken-quote");
  refuse("refuse-comdirect-accounts", decodeOriginal(await readFile(resolve(fixtures, "comdirect.sections.csv"))), "unknown", "One export contains giro and Visa account sections; this single-account import must refuse rather than omit the second account.", "comdirect", "account-sections");
  refuse("refuse-unknown-accounts", "Account;Fictional account A\nBuchungstag;Empfänger;Verwendungszweck;Betrag\n14.10.2026;Fiktiv Laden;Einkauf;-12,00\nAccount;Fictional account B\nBuchungstag;Empfänger;Verwendungszweck;Betrag\n15.10.2026;Fiktiv Laden;Einkauf;-23,00\n", "unknown", "An unfamiliar export contains a separate payment section for each account; silently taking only one loses money movements.", "fictional-German", "account-sections");
  for (const invalid of ["date", "amount"]) {
    const payments = freshPayments(400);
    const rows = [n26Header, ...payments.map((p) => [p.date, p.date, p.counterparty!, "", "Transfer", p.text, "Fictional account", money(p.amountCents, 2), "", "", ""])];
    rows.push([invalid === "date" ? "2026-02-30" : "2026-10-19", "2026-10-19", "Fiktiv bad row", "", "Transfer", "Unreadable row", "Fictional account", invalid === "amount" ? "not-an-amount" : "-1.00", "", "", ""]);
    add(`partial-invalid-${invalid}`, csv(rows, ","), { bank: "n26", kind: "partial-with-warning", situation: "A spreadsheet contains one invalid booking cell after intact payment rows.",
      change: `An impossible ${invalid} in one appended row.`, provenance: { method: "hand", reason: "Only the three intact constructed payments may be read, and the skipped row must be reported." },
      expected: { outcome: "read", payments, warning: { skipped: 1, reason: "One row cannot be read; the skipped count must make that visible." } } });
  }

  await mkdir(folder, { recursive: true });
  for (const [name, { bytes, spec }] of generated) {
    await writeFile(resolve(folder, spec.file), bytes);
    await writeFile(resolve(folder, `${name}.case.json`), JSON.stringify(spec, null, 2) + "\n");
  }
  return generated.size;
}

async function main() {
  const args = process.argv.slice(2);
  let seed = DEFAULT_SEED, folder = fileURLToPath(new URL("cases/", import.meta.url));
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--seed" && /^\d+$/.test(args[i + 1] ?? "")) seed = Number(args[++i]);
    else if (args[i] === "--out" && args[i + 1]) folder = resolve(args[++i]);
    else throw new Error("Usage: npx tsx eval/files/make.ts [--seed <integer>] [--out <directory>]");
  }
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Seed must be a 32-bit unsigned integer.");
  console.log(`Wrote ${await makeCases(folder, seed)} file cases (seed ${seed}) to ${folder}.`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
