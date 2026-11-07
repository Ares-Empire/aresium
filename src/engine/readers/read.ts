// One entry for any bank file: decode the bytes, find the format, read it.
// Order: CAMT (XML), MT940, PayPal CSV, a layout the person confirmed before, a known bank layout, and last an
// unknown CSV, whose guessed layout comes back for the person to confirm (nothing is imported until then).
import { archiveBankTexts, readArchive } from "./archive.js";
import { isZip, unzipBankFile } from "./zip.js";
import { isXlsx, xlsxTableText } from "./xlsx.js";
import { parsePaypalCsv } from "./paypal.js";
import { parseVrBankCsv } from "../../import/vrbank-csv.js";
import type { ParsedFile } from "../../import/types.js";
import { readCamt } from "./camt.js";
import { detectSeparator, splitCsv, type Separator } from "./csv.js";
import { decodeBankFileWithEncoding } from "./decode.js";
import { findTableStart, guessCsvLayout } from "./guess.js";
import { withOccurrences } from "./ids.js";
import { readMt940 } from "./mt940.js";
import { BANK_PROFILES, findProfile, profileDateAmbiguous, profileLayout, type BankProfile } from "./profiles.js";
import { accountName, BankFileError, checkedCsvRows, findTable, readTable } from "./table.js";
import { DATE_FORMATS, headerKey, normalizeIban, parseAmountStrict, parseDate } from "./values.js";
import type { BankFile, BankTxn, ColumnInfo, CsvLayout, LayoutGuess } from "./types.js";

export type Detection =
  | { format: "camt"; message?: string } // e.g. "camt.053.001.08"
  | { format: "mt940" }
  | { format: "paypal"; separator: Separator; headerRow: number }
  // headerRow -1: a CSV without a header row
  | { format: "csv"; separator: Separator; headerRow: number; layout?: CsvLayout; profile?: { id: string; bank: string }; dateAmbiguous?: boolean }
  | { format: "unknown"; reason: "empty" | "zip" | "xml" | "noTable" };

const isPaypalHeader = (row: string[]) => {
  const keys = new Set(row.map(headerKey));
  return (keys.has("transaktionscode") || keys.has("transactionid"))
    && ["netto", "net", "brutto", "gross"].some((k) => keys.has(k));
};

// A saved layout fits when one of the first lines equals its header row (or, for a layout without a header row,
// when the first row has its width and a date in its date column). Layouts with a header row are tried first.
function savedLayoutFor(text: string, saved: readonly CsvLayout[]): { layout: CsvLayout; headerRow: number } | null {
  const bySeparator = new Map<Separator, string[][]>();
  const ordered = [...saved].sort((a, b) => Number(a.header.length === 0) - Number(b.header.length === 0));
  for (const layout of ordered) {
    if (!bySeparator.has(layout.separator)) bySeparator.set(layout.separator, splitCsv(text.slice(0, 200000), layout.separator));
    const headerRow = findTable(bySeparator.get(layout.separator)!, layout);
    if (headerRow !== null) return { layout, headerRow };
  }
  return null;
}

// What kind of bank file this text is; for a CSV its separator, header row and, for a known bank or a saved
// layout, the layout that reads it.
export function detectBankFile(text: string, savedLayouts: readonly CsvLayout[] = []): Detection {
  const head = text.replace(/^\uFEFF/, "").trimStart();
  if (head === "") return { format: "unknown", reason: "empty" };
  if (head.startsWith("PK\u0003\u0004")) return { format: "unknown", reason: "zip" };
  if (head.startsWith("<")) {
    if (!/<(\w+:)?Document[\s>]/.test(head) || !/BkToCstmr/.test(head)) return { format: "unknown", reason: "xml" };
    const message = /camt\.05[234]\.\d{3}\.\d{2}/.exec(head)?.[0];
    return message ? { format: "camt", message } : { format: "camt" };
  }
  if (/^:20:/m.test(head) && /^:(61|60F|60M):/m.test(head)) return { format: "mt940" };

  const separator = detectSeparator(head);
  // Header discovery is bounded, but date order must use the whole column, even in large exports.
  const rows = splitCsv(head, separator);
  const paypalRow = rows.slice(0, 5).findIndex(isPaypalHeader);
  if (paypalRow >= 0) return { format: "paypal", separator, headerRow: paypalRow };
  const saved = savedLayoutFor(head, savedLayouts);
  if (saved) return { format: "csv", separator: saved.layout.separator, headerRow: saved.headerRow, layout: saved.layout };
  const known = findProfile(rows);
  const layout = known ? profileLayout(known.profile, rows, known.headerRow, separator) : null;
  if (known && layout) {
    return { format: "csv", separator, headerRow: known.headerRow, layout, profile: { id: known.profile.id, bank: known.profile.bank },
      ...(profileDateAmbiguous(known.profile, rows, known.headerRow, layout) ? { dateAmbiguous: true } : {}) };
  }
  const table = findTableStart(rows);
  return table ? { format: "csv", separator, headerRow: table.headerRow } : { format: "unknown", reason: "noTable" };
}

function isoTransactions(file: ParsedFile): BankTxn[] {
  return file.transactions.map(({ bookingDate, valueDate, ...txn }) => ({
    ...txn,
    bookingDate: bookingDate.toISOString(),
    ...(valueDate === undefined ? {} : { valueDate: valueDate?.toISOString() ?? null }),
  }));
}

const findKnown = (id: string) => BANK_PROFILES.find((p) => p.id === id);
const bankName = (profile: BankProfile) => (profile.variant ? `${profile.bank} (${profile.variant})` : profile.bank);

// A known bank with rewritten ambiguous dates keeps all its column and status rules in the confirmation.
// Guessing the columns afresh could lose fees, currency, purpose text or pending-row rules.
export function dateConfirmation(rows: string[][], headerRow: number, layout: CsvLayout): LayoutGuess {
  if (layout.profile === "volksbank" && headerRow === 0) layout = { ...layout, idStyle: "vrbank" };
  const data = rows.slice(headerRow + 1);
  const c = layout.columns;
  const names = layout.header.length ? layout.header : Array.from({ length: layout.columnCount ?? 0 }, (_, i) => `Column ${i + 1}`);
  const columns: ColumnInfo[] = names.map((header, index) => ({
    index, header, kind: index === c.date || index === c.valueDate ? "date"
      : [c.amount, c.debit, c.credit, c.balance, ...(c.fees ?? []), ...(c.addAmounts ?? [])].includes(index) ? "amount"
        : [c.iban, c.accountIban].includes(index) ? "iban" : index === c.currency ? "currency" : index === c.sign ? "sign" : "text",
    samples: data.map((r) => r[index] ?? "").filter(Boolean).slice(0, 3),
    ...(index === layout.columns.date ? { dateFormat: layout.dateFormat } : {}),
  }));
  return { layout, confidence: 0.7, unsure: ["dateFormat"], missing: [], separator: layout.separator,
    header: layout.header, headerRow, columns, preview: readTable(rows, headerRow, layout).transactions.slice(0, 5) };
}

// The other party's IBAN in a CSV row kept as a record (column name → cell), from the profile's IBAN column.
export function recordCounterpartyIban(record: unknown, profile: BankProfile): string | undefined {
  if (!record || typeof record !== "object" || profile.columns.iban === undefined) return undefined;
  const names = [profile.columns.iban].flat().filter((name): name is string => typeof name === "string");
  for (const name of names) {
    const value = (record as Record<string, unknown>)[name];
    const iban = typeof value === "string" ? normalizeIban(value) : null;
    if (iban) return iban;
  }
  return undefined;
}

// VR Bank CSV with its header on line 1: the server's reader, so ids stay what they were. Two changes on top,
// both only where the server's reader went wrong: a second identical booking on the same day gets its own id
// (it used to be lost as a duplicate), and a row without a booking date is skipped (it used to get today's date).
// The other party's IBAN is added here (the server's reader leaves it in `raw`). `bank` is the bank the file
// names (a Sparda-Bank exports the same layout); the server's reader calls every such account "VR Bank".
function readVrBank(text: string, profile: BankProfile, bank = profile.bank): BankFile {
  const parsed = parseVrBankCsv(text);
  const dateColumns = ["Buchungstag", "Buchung", "Buchungsdatum"];
  const kept = parsed.transactions.filter((t) => {
    const raw = t.raw as Record<string, string>;
    const value = dateColumns.map((c) => raw[c]).find((v) => v !== undefined && v.trim() !== "") ?? "";
    return DATE_FORMATS.some((f) => parseDate(value, f) !== null);
  });
  const ids = withOccurrences(kept.map((t) => ({
    id: t.externalId,
    fields: `${t.bookingDate.toISOString()}|${t.amount}|${t.description}|${t.counterparty ?? ""}`,
  })));
  // Amounts as every other reader writes them ("-3.20", not the server's "-3.2"); the ids above keep the server's.
  const canonical = (v: string) => parseAmountStrict(v, "en") ?? v;
  const transactions = isoTransactions({ ...parsed, transactions: kept }).map((t, i) => {
    const counterpartyIban = recordCounterpartyIban(t.raw, profile);
    return {
      ...t,
      externalId: ids[i],
      amount: canonical(t.amount),
      ...(t.balance ? { balance: canonical(t.balance) } : {}),
      ...(counterpartyIban ? { counterpartyIban } : {}),
    };
  });
  const name = bank === profile.bank ? parsed.account.name : accountName(bank, parsed.account.iban);
  const account = { name, currency: parsed.account.currency, ...(parsed.account.iban ? { iban: parsed.account.iban } : {}) };
  return {
    format: "csv",
    bank: { id: profile.id, name: bankName(profile) },
    account,
    transactions,
    skipped: parsed.transactions.length - kept.length,
  };
}

// Reads a bank export from its bytes. `savedLayouts` are layouts the person confirmed before (see LayoutGuess).
// An unknown CSV comes back with no transactions and `needsLayout`: show its preview, let the person confirm
// or change the layout, save it, and call again with it (or call readCsv with the decoded text).
export function readBankFile(bytes: ArrayLike<number>, savedLayouts: readonly CsvLayout[] = []): BankFile {
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new BankFileError("xls", "Old Excel (.xls) files cannot be read. Export as CSV or save as .xlsx.");
  }
  if (isZip(bytes)) {
    const files = unzipBankFile(bytes);
    if (isXlsx(files)) return readBankText(xlsxText(files, savedLayouts), savedLayouts);
    return readArchive(archiveBankTexts(files, isBankText), (text) => readBankText(text, savedLayouts));
  }
  const { text, encoding } = decodeBankFileWithEncoding(bytes);
  return { ...readBankText(text, savedLayouts), encoding };
}

const isBankText = (text: string) => detectBankFile(text).format !== "unknown";
const xlsxText = (files: Map<string, Uint8Array>, saved: readonly CsvLayout[]) => xlsxTableText(files, (text) => {
  const format = detectBankFile(text, saved).format;
  return format === "csv" || format === "paypal";
});

// Use the same cells for preview alternatives and for the eventual confirmed import.
export function bankTableText(bytes: ArrayLike<number>, saved: readonly CsvLayout[] = []): string {
  if (!isZip(bytes)) return decodeBankFileWithEncoding(bytes).text;
  const files = unzipBankFile(bytes);
  if (isXlsx(files)) return xlsxText(files, saved);
  const texts = archiveBankTexts(files, isBankText);
  if (texts.length !== 1) throw new BankFileError("zipLayout", "A bank file inside this ZIP needs its columns confirmed. Import that file separately first.");
  return texts[0];
}

// The same for text that is already decoded.
export function readBankText(text: string, savedLayouts: readonly CsvLayout[] = []): BankFile {
  const detected = detectBankFile(text, savedLayouts);
  switch (detected.format) {
    case "camt": return readCamt(text);
    case "mt940": return readMt940(text);
    case "paypal": {
      const rows = checkedCsvRows(text, detected.separator).slice(detected.headerRow);
      const data = rows.slice(1).filter((r) => r.some((v) => v.trim() !== ""));
      if (data.length === 0) throw new BankFileError("noTable", "No readable booked payments were found in this file.");
      const width = Math.min(rows[0].length, data.reduce((n, row) => Math.max(n, row.length), 0));
      if (data.some((r) => r.length < width)) throw new BankFileError("unknown", "A payment row is cut off or has missing columns. Download the file again.");
      // The server's PayPal reader (its ids are PayPal's transaction codes); lines above the header are dropped.
      const table = rows.map((row) => row.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
      const parsed = parsePaypalCsv(table);
      return {
        format: "paypal",
        bank: { id: "paypal", name: "PayPal" },
        account: { name: parsed.account.name, currency: parsed.account.currency },
        transactions: isoTransactions(parsed),
      };
    }
    case "csv": {
      const rows = checkedCsvRows(text, detected.separator);
      const { layout, profile } = detected;
      const known = profile ? findKnown(profile.id) : undefined;
      if (layout && detected.dateAmbiguous) {
        return { format: "csv", transactions: [], needsLayout: dateConfirmation(rows, detected.headerRow, layout) };
      }
      if (known?.reader === "vrbank" && detected.headerRow === 0 && layout) {
        // Apply the same coverage check as other CSVs before entering the legacy id-preserving reader.
        const checked = readTable(rows, detected.headerRow, layout);
        // Do not let the legacy reader's permissive date fallback or amount parser invent a payment from
        // an invalid row. Its valid original cells, descriptions and id formula stay unchanged.
        const c = layout.columns;
        const kept = rows.filter((r, i) => i === 0 || (parseDate(r[c.date] ?? "", layout.dateFormat) !== null
          && parseAmountStrict(r[c.amount!] ?? "", layout.numberFormat) !== null));
        const changedDates = layout.dateFormat === "DD/MM/YYYY";
        if (changedDates) for (let i = 1; i < kept.length; i++) {
          kept[i] = [...kept[i]];
          for (const j of [c.date, c.valueDate]) if (j !== undefined) {
            kept[i][j] = parseDate(kept[i][j] ?? "", layout.dateFormat) ?? "";
          }
        }
        // The legacy reader detects only comma/semicolon. Feed it the same cells after a spreadsheet's
        // tab export, keeping its descriptions and id formula.
        const compatible = changedDates || kept.length !== rows.length || detected.separator === "\t" || detected.separator === "|"
          ? kept
            .map((row) => row.map((v) => `"${v.replace(/"/g, '""')}"`).join(";")).join("\n")
          : text;
        return { ...readVrBank(compatible, known, layout.name), skipped: checked.skipped };
      }
      if (layout) {
        const file = readTable(rows, detected.headerRow, layout);
        return known ? { ...file, bank: { id: known.id, name: bankName(known) } } : file;
      }
      return { format: "csv", transactions: [], needsLayout: guessCsvLayout(text.replace(/^\uFEFF/, "")) };
    }
    case "unknown": {
      const messages = {
        empty: "The file is empty.",
        zip: "This is a ZIP archive; open it and import the files inside.",
        xml: "This XML file is not a CAMT bank statement (camt.052, .053 or .054).",
        noTable: "No table with a header row and dates was found in this file.",
      } as const;
      const code = detected.reason === "xml" ? "camt" : detected.reason;
      throw new BankFileError(code, messages[detected.reason]);
    }
  }
}
