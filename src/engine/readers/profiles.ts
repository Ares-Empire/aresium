// Known CSV layouts: each bank's export described once, by its header names. A file is recognised by the header
// names in `match` (all in one row, anywhere in the first 60 lines); the profile with the most matching names
// wins. A bank whose export has no header row (Targobank) is recognised by the shape of its rows instead.
// The profile then becomes a CsvLayout (column numbers) for that file, so known banks and layouts the person
// confirmed are read by the same code (table.ts).
import type { Separator } from "./csv.js";
import { findHeaderRow, trimRow, uniqueHeader } from "./table.js";
import { headerKey, normalizeIban, parseAmountStrict, parseDate, type DateFormat, type NumberFormat } from "./values.js";
import type { CsvLayout } from "./types.js";
import { BANK_PROFILES } from "./bank-profiles.js";

// A header name as the bank writes it (a repeated name is "Name (2)"), or for a file without a header row the
// column's number, counted from 0. A list names the same column as different versions of the export call it;
// the first one the file has is used.
type Column = string | number | (string | number)[];

export type BankProfile = {
  id: string;
  bank: string; // shown as the account's name: "Sparkasse ••3000"
  variant?: string; // which of the bank's exports
  sources: string[]; // where the header line and formats come from
  unconfirmed?: string; // what no public source showed (then the layout is our best reading of the sources)
  separator: Separator | Separator[];
  match: (string | string[])[]; // header names that identify the layout (a list: any one of them); [] with `headerless`
  bankInPreamble?: string[]; // the first of these names found above the table is the bank (shared layouts)
  headerless?: { columnCount: number; ibanColumn?: number }; // rows of this width, with the account's IBAN there
  dateFormat: DateFormat | DateFormat[]; // several: the first that reads this file's dates
  numberFormat: NumberFormat | "either"; // "either": the decimal mark changes between files of the same bank
  columns: {
    date: Column;
    valueDate?: Column;
    amount?: Column;
    debit?: Column;
    credit?: Column;
    sign?: Column;
    counterparty?: Column[]; // the first of these that is filled in the row
    payer?: Column;
    payee?: Column;
    text?: Column[];
    kind?: Column;
    iban?: Column;
    accountIban?: Column;
    balance?: Column;
    currency?: Column;
    reference?: Column;
    status?: Column;
    fees?: Column[];
    addAmounts?: Column[];
  };
  labelledText?: CsvLayout["labelledText"];
  skipStatus?: string[];
  keepStatus?: string[];
  invertSign?: boolean;
  currency?: string;
  // The server's own reader, whose payment ids must stay as they are (VR Bank CSV with its header on line 1).
  reader?: "vrbank";
};

export { BANK_PROFILES };

const separators = (profile: BankProfile) => (Array.isArray(profile.separator) ? profile.separator : [profile.separator]);
const formats = (profile: BankProfile) => (Array.isArray(profile.dateFormat) ? profile.dateFormat : [profile.dateFormat]);
const names = (column: Column): (string | number)[] => (Array.isArray(column) ? column : [column]);

function fitsHeaderless(profile: BankProfile, rows: string[][]): boolean {
  const shape = profile.headerless!;
  const first = rows.find((r) => r.some((v) => v.trim() !== ""));
  if (!first || first.length !== shape.columnCount || typeof profile.columns.date !== "number") return false;
  if (!formats(profile).some((f) => parseDate(first[profile.columns.date as number] ?? "", f) !== null)) return false;
  return shape.ibanColumn === undefined || normalizeIban(first[shape.ibanColumn] ?? "") !== null;
}

// The profile and header row (-1: no header row) for this file's rows, if a known layout fits. The table that
// comes first wins (a file with several sections is read from its first), then the profile naming more columns.
export function findProfile(rows: string[][], separator: Separator): { profile: BankProfile; headerRow: number } | null {
  let best: { profile: BankProfile; headerRow: number } | null = null;
  for (const profile of BANK_PROFILES) {
    if (!separators(profile).includes(separator)) continue;
    if (profile.headerless) {
      if (!best && fitsHeaderless(profile, rows)) best = { profile, headerRow: -1 };
      continue;
    }
    const headerRow = findHeaderRow(rows, profile.match.map((m) => (Array.isArray(m) ? m : [m]).map(headerKey)));
    if (headerRow < 0) continue;
    if (!best || best.headerRow < 0 || headerRow < best.headerRow
      || (headerRow === best.headerRow && profile.match.length > best.profile.match.length)) best = { profile, headerRow };
  }
  return best;
}

// "either": the decimal mark the amounts of this file use.
function fileNumberFormat(rows: string[][], columns: number[]): NumberFormat {
  let de = 0, en = 0;
  for (const row of rows) for (const j of columns) {
    const v = row[j] ?? "";
    if (parseAmountStrict(v, "de") !== null && /,\d/.test(v)) de++;
    if (parseAmountStrict(v, "en") !== null && /\.\d/.test(v)) en++;
  }
  return en > de ? "en" : "de";
}

// The profile as a layout for this file. Null when a column the reading needs is missing.
export function profileLayout(profile: BankProfile, rows: string[][], headerRow: number, separator: Separator): CsvLayout | null {
  const header = headerRow >= 0 ? trimRow(rows[headerRow]) : [];
  const keys = uniqueHeader(headerRow >= 0 ? rows[headerRow].map((h) => h.trim()) : []).map(headerKey);
  const at = (column: Column | undefined) => {
    for (const name of column === undefined ? [] : names(column)) {
      if (typeof name === "number") return name;
      const i = keys.indexOf(headerKey(name));
      if (i >= 0) return i;
    }
    return undefined;
  };
  const p = profile.columns;
  const columns: CsvLayout["columns"] = { date: at(p.date) ?? -1 };
  for (const role of ["valueDate", "amount", "debit", "credit", "sign", "payer", "payee", "kind", "iban",
    "accountIban", "balance", "currency", "reference", "status"] as const) {
    const i = at(p[role]);
    if (i !== undefined) columns[role] = i;
  }
  for (const role of ["counterparty", "text", "fees", "addAmounts"] as const) {
    const list = (p[role] ?? []).map(at).filter((i): i is number => i !== undefined);
    if (list.length > 0) columns[role] = list;
  }
  if (columns.date < 0) return null;
  if (columns.amount === undefined && (columns.debit === undefined || columns.credit === undefined)) return null;
  const amountColumns = [columns.amount, columns.debit, columns.credit].filter((i): i is number => i !== undefined);
  const data = rows.slice(headerRow + 1).filter((r) => r.some((v) => v.trim() !== "")).slice(0, 20);
  const dateFormat = formats(profile).find((f) => data.some((r) => parseDate(r[columns.date] ?? "", f) !== null)) ?? formats(profile)[0];
  const above = rows.slice(0, Math.max(headerRow, 0)).map((r) => r.join(" ").toLowerCase());
  const name = profile.bankInPreamble?.find((n) => above.some((line) => line.includes(n.toLowerCase()))) ?? profile.bank;
  return {
    version: 1,
    name,
    profile: profile.id,
    separator,
    header,
    ...(profile.headerless ? { columnCount: profile.headerless.columnCount } : {}),
    dateFormat,
    numberFormat: profile.numberFormat === "either" ? fileNumberFormat(data, amountColumns) : profile.numberFormat,
    columns,
    ...(profile.skipStatus ? { skipStatus: profile.skipStatus } : {}),
    ...(profile.keepStatus ? { keepStatus: profile.keepStatus } : {}),
    ...(profile.invertSign ? { invertSign: true } : {}),
    ...(profile.currency ? { currency: profile.currency } : {}),
    ...(profile.labelledText ? { labelledText: profile.labelledText } : {}),
  };
}
