// Reading a CSV export with a layout: find the table under any account details the bank puts above it, then
// turn each row into a payment. Rows without a readable date or amount (totals, "offen", empty lines) and rows
// that are not booked yet are skipped and counted.
import { splitCsv } from "./csv.js";
import { bookingIds } from "./ids.js";
import {
  absolute, addAmounts, cleanText, headerKey, negate, normalizeIban, parseAmountStrict, parseDate, sepaPaymentText,
} from "./values.js";
import type { BankAccount, BankFile, BankTxn, CsvLayout } from "./types.js";

// Errors carry a code; the app words them in its own language.
export type BankFileErrorCode = "empty" | "noTable" | "headerMismatch" | "camt" | "mt940" | "zip" | "unknown";
export class BankFileError extends Error {
  constructor(readonly code: BankFileErrorCode, message: string) {
    super(message);
    this.name = "BankFileError";
  }
}

// Trailing empty cells (a separator at the end of the line) do not count.
export function trimRow(row: string[]): string[] {
  let end = row.length;
  while (end > 0 && row[end - 1].trim() === "") end--;
  return row.slice(0, end).map((cell) => cell.trim());
}

// The first row, among the first 60, that holds one of each group of `keys` (header keys, see headerKey).
export function findHeaderRow(rows: string[][], keys: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const present = new Set(rows[i].map(headerKey));
    if (keys.every((group) => group.some((k) => present.has(k)))) return i;
  }
  return -1;
}

// Where the layout's table starts in these rows: the row that equals its header (compared as header keys), or,
// for a layout without a header row, -1 when the first row has the layout's width and a date in its date column.
// Null when the rows do not fit the layout.
export function findTable(rows: string[][], layout: CsvLayout): number | null {
  if (layout.header.length === 0) {
    const first = rows.find((r) => r.some((v) => v.trim() !== ""));
    const fits = first !== undefined && (layout.columnCount === undefined || first.length === layout.columnCount)
      && parseDate(cell(first, layout.columns.date), layout.dateFormat) !== null;
    return fits ? -1 : null;
  }
  const want = trimRow(layout.header).map(headerKey).join("\u001f");
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    if (trimRow(rows[i]).map(headerKey).join("\u001f") === want) return i;
  }
  return null;
}

// Header names as record keys; a name that repeats gets " (2)", " (3)", ... (ING has two "Währung" columns).
export function uniqueHeader(header: string[]): string[] {
  const seen = new Map<string, number>();
  return header.map((name, i) => {
    const base = name.trim() || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

// A valid IBAN anywhere in a cell ("DE12 3456 ... / Girokonto").
export function findIban(text: string): string | undefined {
  for (const m of text.toUpperCase().matchAll(/[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}/g)) {
    // The match may run into following words; shorten it until the check digits fit.
    const compact = m[0].replace(/\s/g, "");
    for (let len = compact.length; len >= 15; len--) {
      const iban = normalizeIban(compact.slice(0, len));
      if (iban) return iban;
    }
  }
  return undefined;
}

// The part of `text` after `label` (followed by ":" or "."), up to the next of `labels`. The label "" is the
// part before the first label.
function labelledPart(text: string, label: string, labels: string[]): string {
  const escape = (l: string) => l.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const start = label === "" ? { index: 0, 0: "" } : new RegExp(`(?:^|\\s)${escape(label)}\\s*[:.]`, "i").exec(text);
  if (!start) return "";
  const rest = text.slice(start.index + start[0].length);
  const next = new RegExp(`(?:^|\\s)(?:${labels.map(escape).join("|")})\\s*[:.]`, "i").exec(rest);
  return cleanText(next ? rest.slice(0, next.index) : rest);
}

const DEBIT_MARK = /^(s|soll|d|db|dbit|debit|belastung|lastschrift|-)$/i;
const CREDIT_MARK = /^(h|haben|c|cr|crdt|credit|gutschrift|\+)$/i;

// What a sign column's cell says: money out (S, Soll, D, Debit, Lastschrift, -), money in (H, Haben, C, Credit,
// Gutschrift, +), or neither (the amount keeps its own sign).
export function signMark(value: string): "debit" | "credit" | null {
  const v = value.trim();
  return DEBIT_MARK.test(v) ? "debit" : CREDIT_MARK.test(v) ? "credit" : null;
}

export function accountName(bank: string, iban?: string): string {
  return iban ? `${bank} ••${iban.slice(-4)}` : bank;
}

function cell(row: string[], index: number | undefined): string {
  return index === undefined ? "" : (row[index] ?? "").trim();
}

// Reads the CSV text with a layout, as returned by guessCsvLayout or a known profile and confirmed by the person.
export function readCsv(text: string, layout: CsvLayout): BankFile {
  const rows = splitCsv(text, layout.separator);
  if (rows.length === 0) throw new BankFileError("empty", "The file is empty.");
  const headerIndex = findTable(rows, layout);
  if (headerIndex === null) throw new BankFileError("headerMismatch", "The file's header row does not match the layout.");
  return readTable(rows, headerIndex, layout);
}

// Reads the rows below the header row (all rows when headerIndex is -1: a file without a header row).
export function readTable(rows: string[][], headerIndex: number, layout: CsvLayout): BankFile {
  const c = layout.columns;
  const width = layout.columnCount ?? Math.max(0, ...rows.slice(0, 50).map((r) => r.length));
  const names = uniqueHeader(headerIndex >= 0 ? rows[headerIndex].map((h) => h.trim()) : new Array<string>(width).fill(""));
  const transactions: Omit<BankTxn, "externalId">[] = [];
  const idFields: string[] = [];
  const references: (string | undefined)[] = [];
  let skipped = 0;
  let ownIban: string | undefined;
  let currency = layout.currency ?? "EUR";
  const skip = (layout.skipStatus ?? []).map((s) => s.toLowerCase());
  const keep = (layout.keepStatus ?? []).map((s) => s.toLowerCase());
  // A file with several sections (comdirect: giro account, then card, then savings) repeats the header name of
  // the date column at the next section's table; reading stops there, and the rest counts as skipped.
  const dateHeader = headerIndex >= 0 ? headerKey(rows[headerIndex][c.date] ?? "") : "";

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((v) => v.trim() === "")) continue;
    if (dateHeader && headerKey(cell(row, c.date)) === dateHeader) {
      skipped += rows.slice(r).filter((rest) => rest.some((v) => v.trim() !== "")).length;
      break;
    }
    const date = parseDate(cell(row, c.date), layout.dateFormat);
    const status = cell(row, c.status).toLowerCase();
    if (!date || (c.status !== undefined && (skip.some((s) => status.includes(s)) ||
        (keep.length > 0 && !keep.some((s) => status.includes(s)))))) { skipped++; continue; }

    let amount: string | null = null;
    if (c.amount !== undefined) {
      amount = parseAmountStrict(cell(row, c.amount), layout.numberFormat);
      const mark = signMark(cell(row, c.sign));
      if (amount && c.sign !== undefined) {
        if (mark === "debit") amount = negate(absolute(amount));
        else if (mark === "credit") amount = absolute(amount);
      }
    } else {
      const debit = parseAmountStrict(cell(row, c.debit), layout.numberFormat);
      const credit = parseAmountStrict(cell(row, c.credit), layout.numberFormat);
      if (debit && !/^0\.0+$/.test(debit)) amount = negate(absolute(debit));
      else if (credit) amount = absolute(credit);
      else if (debit) amount = debit;
    }
    if (!amount) { skipped++; continue; }
    if (layout.invertSign) amount = negate(amount);
    for (const j of c.fees ?? []) {
      const fee = parseAmountStrict(cell(row, j), layout.numberFormat);
      if (fee) amount = addAmounts(amount, negate(absolute(fee)));
    }
    for (const j of c.addAmounts ?? []) {
      const extra = parseAmountStrict(cell(row, j), layout.numberFormat);
      if (extra) amount = addAmounts(amount, extra);
    }
    if (/^-?0\.0+$/.test(amount)) { skipped++; continue; } // notices with no money moved

    const out = amount.startsWith("-");
    let counterparty = (out ? cell(row, c.payee) || cell(row, c.payer) : cell(row, c.payer) || cell(row, c.payee))
      || (c.counterparty ?? []).map((i) => cell(row, i)).find(Boolean) || "";
    let paymentText = sepaPaymentText(cleanText(...(c.text ?? []).map((i) => cell(row, i))));
    if (layout.labelledText) {
      const { labels, counterparty: names, text: texts } = layout.labelledText;
      const whole = paymentText;
      counterparty ||= names.map((l) => labelledPart(whole, l, labels)).find(Boolean) ?? "";
      const labelled = texts.map((l) => labelledPart(whole, l, labels)).find(Boolean);
      if (labelled !== undefined) paymentText = labelled;
      else if (counterparty) paymentText = "";
    }
    const description = paymentText || cleanText(cell(row, c.kind)) || cleanText(counterparty) || "(no description)";
    const valueDate = c.valueDate !== undefined ? parseDate(cell(row, c.valueDate), layout.dateFormat) : undefined;
    const balance = c.balance !== undefined ? parseAmountStrict(cell(row, c.balance), layout.numberFormat) : undefined;
    const rowCurrency = /^[A-Za-z]{3}$/.test(cell(row, c.currency)) ? cell(row, c.currency).toUpperCase() : currency;
    currency = rowCurrency;
    ownIban ??= c.accountIban !== undefined ? normalizeIban(cell(row, c.accountIban)) ?? undefined : undefined;
    // Only a real IBAN: some banks' "Kontonummer" columns hold an old account number.
    const counterpartyIban = c.iban !== undefined ? normalizeIban(cell(row, c.iban)) : null;

    const raw: Record<string, string> = {};
    names.forEach((name, i) => { raw[name] = (row[i] ?? "").trim(); });
    transactions.push({
      bookingDate: `${date}T00:00:00.000Z`,
      ...(c.valueDate !== undefined ? { valueDate: valueDate ? `${valueDate}T00:00:00.000Z` : null } : {}),
      amount,
      ...(c.balance !== undefined ? { balance: balance ?? null } : {}),
      currency: rowCurrency,
      description,
      counterparty: cleanText(counterparty) || null,
      ...(counterpartyIban ? { counterpartyIban } : {}),
      raw,
    });
    // The booking fields identify the booking: date and amount as read, the parties' and text cells as written
    // (before any SEPA or label parsing), the other party's IBAN. Not the whole row: some banks export columns
    // the person edits in online banking (category, note, flag), which would give the booking a new id.
    idFields.push([date, amount, ...[c.payer, c.payee, ...(c.counterparty ?? []), ...(c.text ?? [])].map((i) => cleanText(cell(row, i))),
      cell(row, c.iban).replace(/\s/g, "")].join("|"));
    references.push(cell(row, c.reference).replace(/^'+|'+$/g, "") || undefined); // Amex writes 'AT123…'
  }

  if (!ownIban) for (const row of rows.slice(0, Math.max(headerIndex, 0))) ownIban ??= findIban(row.join(" "));
  const hashed = bookingIds(idFields);
  const ids = withReferences(references, hashed);
  const name = layout.name ?? "Bank";
  const account: BankAccount = { name: accountName(name, ownIban), currency };
  if (ownIban) account.iban = ownIban;
  return {
    format: "csv",
    account,
    transactions: transactions.map((t, i) => ({ externalId: ids[i], ...t })),
    skipped,
    layout,
  };
}

// The bank's reference where the row has one; a reference that repeats in the file falls back to the hash.
function withReferences(references: (string | undefined)[], hashed: string[]): string[] {
  const counts = new Map<string, number>();
  for (const ref of references) if (ref) counts.set(ref, (counts.get(ref) ?? 0) + 1);
  return references.map((ref, i) => (ref && counts.get(ref) === 1 ? ref : hashed[i]));
}
