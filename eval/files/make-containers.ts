// Constructed containers and OOXML, independently of the engine. Frozen CSV answers remain the oracle.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { strToU8, zipSync, type Zippable } from "fflate";
import { cents, type FileCase, type Payment } from "./types.js";

export function bankZip(entries: Record<string, string | Uint8Array>): Buffer {
  const files: Zippable = {};
  for (const [name, value] of Object.entries(entries)) files[name] = [typeof value === "string" ? strToU8(value) : value,
    // fflate writes the ZIP's DOS time from the local clock, so the date is built from local parts: the same bytes in
    // every time zone (01:00 keeps the bytes first made in Berlin, where 00:00 UTC was 01:00).
    { mtime: new Date(1980, 0, 1, 1, 0, 0) }];
  return Buffer.from(zipSync(files, { level: 6 }));
}
export function encryptedZip(bytes: Uint8Array, local = true, central = true): Buffer {
  const b = Buffer.from(bytes);
  for (let p = 0; p + 46 <= b.length; p++) {
    const sig = b.readUInt32LE(p);
    if (local && sig === 0x04034b50) b[p + 6] |= 1;
    if (central && sig === 0x02014b50) b[p + 8] |= 1;
  }
  return b;
}
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export type ExcelCell = string | { value: string; type: "date" | "number" | "boolean" | "formula"; style?: number };
export function bankWorkbook(rows: ExcelCell[][], mac = false, leadingEmptySheet = false): Buffer {
  const shared: string[] = [];
  const column = (index: number): string => index < 26 ? String.fromCharCode(65 + index) : column(Math.floor(index / 26) - 1) + column(index % 26);
  const worksheet = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rows.map((row, r) => `<row r="${r + 1}">` + row.map((cell, c) => {
    const ref = `${column(c)}${r + 1}`;
    if (cell === "") return ""; // Sparse cells are normal in real workbooks.
    if (typeof cell === "string") {
      if ((r + c) % 2) return `<c r="${ref}" t="inlineStr"><is><r><t xml:space="preserve">${escape(cell)}</t></r></is></c>`;
      const i = shared.push(cell) - 1;
      return `<c r="${ref}" t="s"><v>${i}</v></c>`;
    }
    if (cell.type === "boolean") return `<c r="${ref}" t="b"><v>${cell.value}</v></c>`;
    if (cell.type === "formula") return `<c r="${ref}"><f>1+1</f><v>${cell.value}</v></c>`;
    const value = cell.type === "date" ? String((Date.parse(cell.value) - Date.parse(mac ? "1904-01-01" : "1899-12-30")) / 86400000) : cell.value;
    return `<c r="${ref}" s="${cell.style ?? (cell.type === "date" ? 1 : 2)}"><v>${value}</v></c>`;
  }).join("") + '</row>').join("") + '</sheetData></worksheet>';
  return bankZip({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/bookings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/cover.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="root" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="${mac ? 1 : 0}"/><sheets>${leadingEmptySheet ? '<sheet name="Cover" sheetId="1" r:id="cover"/>' : ''}<sheet name="Bookings" sheetId="2" r:id="bookings"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="cover" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/cover.xml"/><Relationship Id="bookings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/bookings.xml"/></Relationships>',
    "xl/worksheets/cover.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c t="inlineStr"><is><t>Fictional export</t></is></c></row></sheetData></worksheet>',
    "xl/worksheets/bookings.xml": worksheet,
    "xl/sharedStrings.xml": '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + shared.map((s) => `<si><t xml:space="preserve">${escape(s)}</t></si>`).join("") + '</sst>',
    "xl/styles.xml": '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="2"/></cellXfs></styleSheet>',
  });
}

export const zipPayments: Payment[] = [
  { date: "2026-10-14", amountCents: -1230, currency: "EUR", counterparty: "Fiktiv Herbstmarkt", text: "Invented purchase" },
  { date: "2026-10-15", amountCents: 3456, currency: "EUR", counterparty: "Fiktiv Beispielwerke", text: "Invented refund" },
  { date: "2026-10-16", amountCents: -789, currency: "EUR", counterparty: "Fiktiv Herbstmarkt", text: "Invented second purchase" },
];
export function bankCamt(indices: number[], iban = "DE45760501010000987654", report = false): string {
  const tag = report ? "Rpt" : "Stmt", kind = report ? "BkToCstmrAcctRpt" : "BkToCstmrStmt";
  return `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.05${report ? 2 : 3}.001.08"><${kind}><${tag}><Acct><Id><IBAN>${iban}</IBAN></Id><Ccy>EUR</Ccy><Svcr><FinInstnId><BICFI>SSKMDEMMXXX</BICFI></FinInstnId></Svcr></Acct>` + indices.map((i) => {
    const p = zipPayments[i], party = p.amountCents < 0 ? "Cdtr" : "Dbtr";
    return `<Ntry><Amt Ccy="EUR">${(Math.abs(p.amountCents) / 100).toFixed(2)}</Amt><CdtDbtInd>${p.amountCents < 0 ? "DBIT" : "CRDT"}</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>${p.date}</Dt></BookgDt><AcctSvcrRef>ZIP-FICTION-${i + 1}</AcctSvcrRef><NtryDtls><TxDtls><RltdPties><${party}><Pty><Nm>${p.counterparty}</Nm></Pty></${party}></RltdPties><RmtInf><Ustrd>${p.text}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`;
  }).join("") + `</${tag}></${kind}></Document>`;
}

export async function containerCases(fixtures: string, seed: number): Promise<Map<string, { bytes: Buffer; spec: FileCase }>> {
  const cases = new Map<string, { bytes: Buffer; spec: FileCase }>();
  const add = (name: string, ext: string, bytes: Buffer, details: Omit<FileCase, "version" | "file" | "seed">) => cases.set(name,
    { bytes, spec: { version: 1, file: `${name}.${ext}`, seed, ...details } });
  const refuse = (name: string, ext: string, bytes: Buffer, code: string, reason: string) => add(name, ext, bytes,
    { bank: "container", kind: "container-refusal", situation: reason, change: name, provenance: { method: "hand", reason }, expected: { outcome: "refuse", code, reason } });
  const days = { "statements/day3.xml": bankCamt([2]), "statements/day1.xml": bankCamt([0]), "statements/day2.xml": bankCamt([1, 2], undefined, true) };
  for (const mac of [false, true]) add(`zip-camt${mac ? '-macos' : ''}`, "zip", bankZip(mac ? { ...days, "__MACOSX/._day1.xml": "ignored", ".hidden.csv": "ignored", "folder/.hidden/bank.xml": bankCamt([0], "DE96100500000000123456") } : days),
    { bank: "sparkasse-camt", kind: "zip-camt", situation: "Sparkasse sends daily CAMT statements with overlapping .052 and .053 bookings in one ZIP.", change: "Daily XML entries with one account; overlap removed by bank reference.",
      provenance: { method: "construction", reason: "Three payments and their bank references are written before the XML and ZIP." }, expected: { outcome: "read", payments: zipPayments }, reimport: { originalIds: zipPayments.map((_, i) => `ZIP-FICTION-${i + 1}`) } });
  for (const name of ["n26.csv", "dkb.csv", "sparkasse-camt.csv", "mt940.sta"]) {
    const bytes = await readFile(resolve(fixtures, name)), reference = name + ".expected.json", raw = await readFile(resolve(fixtures, reference));
    const answer = JSON.parse(raw.toString());
    const base = { bank: answer.bank?.id ?? "mt940", situation: "A bank export is delivered in a container without changing the payments.",
      provenance: { method: "original" as const, fixture: name, reference, sha256: createHash("sha256").update(raw).digest("hex") },
      expected: { outcome: "read" as const, payments: answer.transactions.map((t: any) => ({ date: t.bookingDate.slice(0, 10), amountCents: cents(t.amount)!, currency: t.currency, counterparty: t.counterparty ?? null, text: t.description })) },
      reimport: { originalIds: answer.transactions.map((t: any) => t.externalId) } };
    if (name === "n26.csv" || name === "mt940.sta") add(`zip-${name.split('.')[0]}`, "zip", bankZip({ [name]: bytes }), { ...base, kind: "zip-bank-file", change: "One unchanged export in a ZIP." });
    if (!name.endsWith("csv")) continue;
    const source = new TextDecoder(name.startsWith("sparkasse") ? "windows-1252" : "utf-8").decode(bytes).replace(/^\uFEFF/, "");
    const rows = parse(source, { delimiter: answer.layout.separator, relax_column_count: true, skip_empty_lines: true }) as string[][];
    const c = answer.layout.columns;
    const dates = [c.date, c.valueDate].filter((x) => x !== undefined), amounts = [c.amount, c.debit, c.credit, c.balance, ...(c.fees ?? []), ...(c.addAmounts ?? [])].filter((x) => x !== undefined);
    const changed = rows.map((row): ExcelCell[] => row.map((value, col) => {
      if (dates.includes(col)) {
        const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(value);
        if (m) return { type: "date", value: `${m[3].length === 2 ? "20" : ""}${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` };
        if (/^\d{4}-\d\d-\d\d$/.test(value)) return { type: "date", value };
      }
      if (amounts.includes(col)) {
        const plain = answer.layout.numberFormat === "de" ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
        if (/^-?\d+(\.\d+)?$/.test(plain)) return { type: "number", value: String(Number(plain)) };
      }
      return value;
    }));
    add(`xlsx-${name.split('.')[0]}`, "xlsx", bankWorkbook(changed, name === "dkb.csv", true), { ...base, kind: "xlsx-known-bank", change: "Dates become serials; amounts become numeric cells; shared and inline strings; sparse cells; 1904 for DKB." });
  }
  const rows: ExcelCell[][] = [["Booking Date", "Payee", "Description", "Amount", "Currency", "Checked"], ...zipPayments.map((p): ExcelCell[] => [
    { type: "date", value: p.date }, p.counterparty!, p.text, { type: "number", value: String(p.amountCents / 100) }, p.currency, { type: "boolean", value: "1" }])];
  add("xlsx-unknown", "xlsx", bankWorkbook(rows), { bank: "fictional-English", kind: "xlsx-unknown-bank", situation: "An unfamiliar bank provides an Excel table; its layout needs confirmation.", change: "Constructed payments with serial dates, numeric money, booleans and strings.", provenance: { method: "construction", reason: "The three integer-cent payments precede the workbook." }, expected: { outcome: "read", payments: zipPayments } });
  refuse("zip-two-accounts", "zip", bankZip({ "a.xml": bankCamt([0]), "b.xml": bankCamt([1], "DE96100500000000123456") }), "zipAccounts", "Two bank accounts cannot be represented by one BankFile.");
  refuse("zip-no-bank", "zip", bankZip({ "readme.txt": "This is an invented document." }), "zipNoBankFile", "A ZIP with no bank export must be refused.");
  refuse("zip-nested", "zip", bankZip({ "nested.zip": bankZip(days), "workbook.xlsx": bankWorkbook(rows) }), "zipNoBankFile", "Nested ZIPs and workbooks inside ZIPs must not be followed.");
  refuse("zip-oversized", "zip", bankZip({ "large.csv": new Uint8Array(50 * 1024 * 1024 + 1) }), "zipLimit", "The total unpacked size exceeds 50 MiB.");
  refuse("zip-too-many-entries", "zip", bankZip(Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`empty-${i}.txt`, ""]))), "zipLimit", "The archive exceeds 2,000 entries, even when entries are empty.");
  refuse("zip-encrypted", "zip", encryptedZip(bankZip({ "bank.xml": bankCamt([0]) })), "zipEncrypted", "An entry is marked encrypted and must never be inflated or imported.");
  refuse("old-excel", "xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), "xls", "Old binary Excel files must be exported as CSV or saved as .xlsx.");
  return cases;
}
