// One entry for any bank file: decode the bytes, find the format, read it.
// Order: CAMT (XML), MT940, PayPal CSV, a layout the person confirmed before, a known bank layout, and last an
// unknown CSV, whose guessed layout comes back for the person to confirm (nothing is imported until then).
import { parsePaypalCsv } from "../../import/paypal-csv.js";
import { parseVrBankCsv } from "../../import/vrbank-csv.js";
import type { ParsedFile } from "../../import/types.js";
import { readCamt } from "./camt.js";
import { detectSeparator, splitCsv, type Separator } from "./csv.js";
import { decodeBankFileWithEncoding } from "./decode.js";
import { findTableStart, guessCsvLayout } from "./guess.js";
import { withOccurrences } from "./ids.js";
import { readMt940 } from "./mt940.js";
import { BANK_PROFILES, findProfile, profileLayout, type BankProfile } from "./profiles.js";
import { BankFileError, findTable, readTable } from "./table.js";
import { DATE_FORMATS, headerKey, normalizeIban, parseAmountStrict, parseDate } from "./values.js";
import type { BankFile, BankTxn, CsvLayout } from "./types.js";

export type Detection =
  | { format: "camt"; message?: string } // e.g. "camt.053.001.08"
  | { format: "mt940" }
  | { format: "paypal"; separator: Separator; headerRow: number }
  // headerRow -1: a CSV without a header row
  | { format: "csv"; separator: Separator; headerRow: number; layout?: CsvLayout; profile?: { id: string; bank: string } }
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
  const rows = splitCsv(head.slice(0, 200000), separator);
  const paypalRow = rows.slice(0, 5).findIndex(isPaypalHeader);
  if (paypalRow >= 0) return { format: "paypal", separator, headerRow: paypalRow };
  const saved = savedLayoutFor(head, savedLayouts);
  if (saved) return { format: "csv", separator: saved.layout.separator, headerRow: saved.headerRow, layout: saved.layout };
  const known = findProfile(rows, separator);
  const layout = known ? profileLayout(known.profile, rows, known.headerRow, separator) : null;
  if (known && layout) {
    return { format: "csv", separator, headerRow: known.headerRow, layout, profile: { id: known.profile.id, bank: known.profile.bank } };
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
// The other party's IBAN is added here (the server's reader leaves it in `raw`).
function readVrBank(text: string, profile: BankProfile): BankFile {
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
  const account = { name: parsed.account.name, currency: parsed.account.currency, ...(parsed.account.iban ? { iban: parsed.account.iban } : {}) };
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
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    throw new BankFileError("zip", "This is a ZIP archive; open it and import the files inside.");
  }
  const { text, encoding } = decodeBankFileWithEncoding(bytes);
  return { ...readBankText(text, savedLayouts), encoding };
}

// The same for text that is already decoded.
export function readBankText(text: string, savedLayouts: readonly CsvLayout[] = []): BankFile {
  const detected = detectBankFile(text, savedLayouts);
  switch (detected.format) {
    case "camt": return readCamt(text);
    case "mt940": return readMt940(text);
    case "paypal": {
      // The server's PayPal reader (its ids are PayPal's transaction codes); lines above the header are dropped.
      const table = detected.headerRow === 0 ? text : text.replace(/^\uFEFF/, "").split(/\r?\n/).slice(detected.headerRow).join("\n");
      const parsed = parsePaypalCsv(table);
      return {
        format: "paypal",
        bank: { id: "paypal", name: "PayPal" },
        account: { name: parsed.account.name, currency: parsed.account.currency },
        transactions: isoTransactions(parsed),
      };
    }
    case "csv": {
      const { layout, profile } = detected;
      const known = profile ? findKnown(profile.id) : undefined;
      if (known?.reader === "vrbank" && detected.headerRow === 0) return readVrBank(text, known);
      if (layout) {
        const rows = splitCsv(text.replace(/^\uFEFF/, ""), layout.separator);
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
