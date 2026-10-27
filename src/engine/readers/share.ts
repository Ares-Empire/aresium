// A confirmed layout as people can send it to us, so that Aresium learns their bank for everyone: the export's column
// names and formats, never its payments, never the bank's or the person's name for it. A header row is the file's own
// text, though, and some exports put an account number or a date into it. Anything that looks personal stops the
// sharing rather than being left out: a layout with a blanked header cell would not recognise the bank's next file.
// A person's name cannot be told from a column name; a very long cell (more like a sentence than a column name) is
// refused too.
//
// The inbox on the server checks the same again (brief 21: JSON under 8 KB with version 1 and no `name` or `profile`,
// at most 80 header cells, text of at most 80 characters, column numbers 0–80, no string that looks like an IBAN, an
// email address, a date, an amount or a long number). These checks are as strict or stricter, so what passes here
// passes there; every string of the known bank profiles passes both.
import { SEPARATORS } from "./csv.js";
import { DATE_FORMATS } from "./values.js";
import type { CsvLayout } from "./types.js";

export type NotShareableReason =
  | "iban" // an IBAN in a header cell or word
  | "email" // an email address (any "@")
  | "date" // a date ("01.02.2026", "2026-02-01", "1. Februar", "3-Jan-2026", "Feb 2026")
  | "amount" // a number with decimals ("12,34"), or with a currency ("12 EUR", "€ 5")
  | "digits" // an account, card or customer number: five or more digits in a row, or groups of 8+ ("1234/5678")
  | "tooLong" // a header cell or word longer than MAX_CELL characters
  | "tooWide" // more than MAX_COLUMNS columns
  | "tooLarge" // more than MAX_BYTES as JSON
  | "invalid"; // not a layout the readers could use

export type ShareableLayout = { ok: true; layout: CsvLayout };
export type NotShareable = { ok: false; reason: NotShareableReason };

// The brief asked for 40; DKB's old Visa export has a 47-character column name, and every known bank must pass.
export const MAX_CELL = 60;
export const MAX_COLUMNS = 80;
export const MAX_BYTES = 8000; // the shared layout as JSON (UTF-8); the inbox takes less than 8 KB

// A month's name as a whole word (German or English), for dates such as "1. Februar", "3-Jan-2026" or "Feb 2026".
const MONTH = "(jan|januar|january|feb|februar|february|mär|märz|maerz|mar|march|apr|april|mai|may|jun|juni|june|jul|juli|"
  + "july|aug|august|sep|sept|september|okt|oktober|oct|october|nov|november|dez|dezember|dec|december)\\.?(?![a-zäöüß])";
const DATE = new RegExp(`\\d{1,4}\\s*[./-]\\s*\\d{1,2}\\s*[./-]\\s*\\d{1,4}|\\d{1,2}[\\s./-]*${MONTH}|(^|[^a-zäöüß])${MONTH}[\\s./,-]*\\d`, "i");
// A currency as a sign or a code: "€", "$", "EUR", "Euro" (codes in capitals, so that words are not taken for them).
const CURRENCY = "(€|\\$|£|¥|[Ee]uro?|EURO?|[A-Z]{3})(?![A-Za-z])";
const AMOUNT = new RegExp(`\\d\\s*[.,]\\s*\\d|\\d\\s*${CURRENCY}|(^|[^A-Za-z])${CURRENCY}\\s*\\d`);
// Digit groups joined by spaces, "-", "/" or ".": "4111-1111-1111-1111", "1234/5678", "12 345 678".
const DIGIT_GROUPS = /\d[\d\s./-]*\d/g;
const digitCount = (run: string) => run.replace(/\D/g, "").length;

const LOOKS_PERSONAL: [Exclude<NotShareableReason, "tooLong" | "tooWide" | "tooLarge" | "invalid">, (text: string) => boolean][] = [
  ["email", (t) => t.includes("@")],
  // Two letters, two check digits, then letters and digits in groups, with 8 or more digits (every country's IBAN
  // has), so that "since 2023 at Postbank" is not one.
  ["iban", (t) => (t.match(/[a-z]{2}\s?\d{2}(\s?[a-z0-9]){10,}/gi) ?? []).some((run) => digitCount(run) >= 8)],
  ["date", (t) => DATE.test(t)],
  ["amount", (t) => AMOUNT.test(t)],
  ["digits", (t) => /\d(\s?\d){4,}/.test(t) || (t.match(DIGIT_GROUPS) ?? []).some((run) => digitCount(run) >= 8)],
];

// Why this text may not be sent (a header cell, a status word, a label), or null when it may.
export function looksPersonal(text: string): NotShareableReason | null {
  for (const [reason, test] of LOOKS_PERSONAL) if (test(text)) return reason;
  return text.length > MAX_CELL ? "tooLong" : null;
}

// The length of text in UTF-8, as it is sent (JavaScriptCore has no TextEncoder).
function utf8Length(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

const isColumn = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < MAX_COLUMNS;
const isColumnList = (v: unknown): v is number[] => Array.isArray(v) && v.length > 0 && v.length <= MAX_COLUMNS && v.every(isColumn);
const isWordList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= MAX_COLUMNS && v.every((w) => typeof w === "string");

const SINGLE = ["valueDate", "amount", "debit", "credit", "sign", "payer", "payee", "kind", "iban", "accountIban", "balance",
  "currency", "reference", "status"] as const;
const LISTS = ["counterparty", "text", "fees", "addAmounts"] as const;

// A copy of the layout that is safe to send: the fields the readers use, without `name` and `profile`, or why not.
// The input is checked as plain JSON, as it may come straight from the app's storage.
export function shareableLayout(layout: CsvLayout): ShareableLayout | NotShareable {
  const no = (reason: NotShareableReason): NotShareable => ({ ok: false, reason });
  const input = layout as unknown as Record<string, unknown> | null;
  if (!input || typeof input !== "object" || input.version !== 1) return no("invalid");
  const { separator, header, columnCount, dateFormat, numberFormat, columns, skipStatus, keepStatus, invertSign,
    labelledText, currency } = input;

  if (!SEPARATORS.includes(separator as never) || !DATE_FORMATS.includes(dateFormat as never)) return no("invalid");
  if (numberFormat !== "de" && numberFormat !== "en") return no("invalid");
  if (!Array.isArray(header) || !header.every((h) => typeof h === "string")) return no("invalid");
  if (header.length > MAX_COLUMNS) return no("tooWide");
  if (header.length === 0 && columnCount === undefined) return no("invalid"); // a file without a header row needs its width
  if (columnCount !== undefined) {
    if (!Number.isInteger(columnCount) || (columnCount as number) < 1) return no("invalid");
    if ((columnCount as number) > MAX_COLUMNS) return no("tooWide");
  }

  // Columns: only the ones the readers know, each a column number; a date and an amount (or debit and credit).
  if (!columns || typeof columns !== "object") return no("invalid");
  const given = columns as Record<string, unknown>;
  if (!isColumn(given.date)) return no("invalid");
  const copy: CsvLayout["columns"] = { date: given.date };
  for (const role of SINGLE) {
    if (given[role] === undefined) continue;
    if (!isColumn(given[role])) return no("invalid");
    copy[role] = given[role];
  }
  for (const role of LISTS) {
    if (given[role] === undefined) continue;
    if (!isColumnList(given[role])) return no("invalid");
    copy[role] = [...given[role]];
  }
  if (copy.amount === undefined && (copy.debit === undefined || copy.credit === undefined)) return no("invalid");

  // Words: status words and the labels of a labelled text cell.
  for (const list of [skipStatus, keepStatus]) if (list !== undefined && !isWordList(list)) return no("invalid");
  let labels: CsvLayout["labelledText"];
  if (labelledText !== undefined) {
    const l = labelledText as Record<string, unknown> | null;
    if (!l || typeof l !== "object" || !isWordList(l.labels) || !isWordList(l.counterparty) || !isWordList(l.text)) return no("invalid");
    labels = { labels: [...l.labels], counterparty: [...l.counterparty], text: [...l.text] };
  }
  if (currency !== undefined && (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))) return no("invalid");
  if (invertSign !== undefined && typeof invertSign !== "boolean") return no("invalid");

  const words = [...header, ...((skipStatus as string[] | undefined) ?? []), ...((keepStatus as string[] | undefined) ?? []),
    ...(labels ? [...labels.labels, ...labels.counterparty, ...labels.text] : [])];
  for (const word of words) {
    const reason = looksPersonal(word);
    if (reason) return no(reason);
  }

  const shared: CsvLayout = {
    version: 1,
    separator: separator as CsvLayout["separator"],
    header: [...header],
    ...(columnCount !== undefined ? { columnCount: columnCount as number } : {}),
    dateFormat: dateFormat as CsvLayout["dateFormat"],
    numberFormat,
    columns: copy,
    ...(skipStatus !== undefined ? { skipStatus: [...(skipStatus as string[])] } : {}),
    ...(keepStatus !== undefined ? { keepStatus: [...(keepStatus as string[])] } : {}),
    ...(invertSign === true ? { invertSign: true } : {}),
    ...(labels ? { labelledText: labels } : {}),
    ...(currency !== undefined ? { currency: currency as string } : {}),
  };
  if (utf8Length(JSON.stringify(shared)) > MAX_BYTES) return no("tooLarge");
  return { ok: true, layout: shared };
}
