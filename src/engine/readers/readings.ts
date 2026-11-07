// Several readings of a CSV whose layout is not known, for the app's "Does this look right?": the guessed layout
// first, then the same layout with one thing changed that the guess may have got wrong (day and month swapped, money
// out and money in the other way round, the other party and the payment text swapped, ...). The app shows the first
// payments of one reading; "No" shows the next. Every reading is a complete layout, ready to save, that reads every
// payment the file has. A known bank also gets date readings when a spreadsheet rewrote its dates ambiguously;
// its column rules stay intact. Layouts the person confirmed before are read directly by readBankFile.
//
// The changes the guess itself is unsure of come first (LayoutGuess.unsure); then the ones it has no proof against
// (a credit card that lists purchases as positive amounts, say), so a confident wrong guess can still be corrected.
import { analyseCsv, balanceFits, complementary, type AnalysedColumn } from "./guess.js";
import { bankTableText, dateConfirmation, detectBankFile } from "./read.js";
import { BankFileError, checkedCsvRows, findTable, readTable, signMark } from "./table.js";
import { parseAmountStrict, type DateFormat } from "./values.js";
import type { BankTxn, CsvLayout, LayoutGuess } from "./types.js";

// What a reading changes in the guessed layout:
// - dateFormat: day and month the other way round (03/04 is 3 April or 4 March)
// - debitCredit: the money-out and money-in columns the other way round, or two amount columns that are never filled
//   in the same row read as money out and money in, where the guess read only one of them
// - amount: another amount column is the payment's amount
// - sign: a column of S/H, Soll/Haben, Lastschrift/Gutschrift marks says which way the money went
// - invertSign: every amount the other way round (cards that list purchases as positive amounts)
// - counterpartyText: the column read as the payment text is the other party (and the other way round)
// - counterparty: another text column is the other party
// - valueDate: the booking date and the value date the other way round
export type ReadingReason = "dateFormat" | "debitCredit" | "amount" | "sign" | "invertSign" | "counterpartyText"
  | "counterparty" | "valueDate";

export type FileReading = {
  layout: CsvLayout;
  // What this reading changes in the guess; null for the guess itself, which comes first whenever it reads the file.
  reason: ReadingReason | null;
  preview: BankTxn[]; // the first payments read with this layout, as readBankFile gives them
};

export const MAX_READINGS = 4;
export const PREVIEW_PAYMENTS = 5;

// The order in which changes are offered, among the doubted ones and then among the rest.
const ORDER: readonly ReadingReason[] = ["dateFormat", "debitCredit", "amount", "sign", "invertSign", "counterpartyText",
  "counterparty", "valueDate"];

const OTHER_DAY_ORDER: Partial<Record<DateFormat, DateFormat>> = { "DD/MM/YYYY": "MM/DD/YYYY", "MM/DD/YYYY": "DD/MM/YYYY" };

type Candidate = { layout: CsvLayout; reason: ReadingReason; doubted: boolean };

// The column numbers a layout reads.
function usedColumns(layout: CsvLayout): Set<number> {
  return new Set(Object.values(layout.columns).flat().filter((i): i is number => typeof i === "number"));
}

// The guessed layout with some of its columns replaced; a column set to undefined is left out.
function withColumns(layout: CsvLayout, change: Partial<CsvLayout["columns"]>): CsvLayout {
  const columns: Record<string, unknown> = { ...layout.columns, ...change };
  for (const key of Object.keys(columns)) if (columns[key] === undefined) delete columns[key];
  return { ...layout, columns: columns as CsvLayout["columns"] };
}

// The other layouts worth showing for this guess, each with one change.
function alternatives(guess: LayoutGuess & { layout: CsvLayout }, columns: AnalysedColumn[], guessed: BankTxn[]): Candidate[] {
  const layout = guess.layout, c = layout.columns;
  const unsure = new Set(guess.unsure);
  const used = usedColumns(layout);
  const freeText = columns.filter((col) => col.kind === "text" && !used.has(col.index));
  const out: Candidate[] = [];
  const offer = (reason: ReadingReason, changed: CsvLayout, doubted: boolean) => out.push({ layout: changed, reason, doubted });

  const otherOrder = OTHER_DAY_ORDER[layout.dateFormat];
  if (otherOrder) offer("dateFormat", { ...layout, dateFormat: otherOrder }, unsure.has("dateFormat"));

  // Money out and in: only when the guess had nothing to go by (no header words, balance or minus signs).
  if (c.debit !== undefined && c.credit !== undefined && unsure.has("amount")) {
    offer("debitCredit", withColumns(layout, { debit: c.credit, credit: c.debit }), true);
  }
  if (c.amount !== undefined && unsure.has("amount")) {
    for (const col of columns.filter((col) => col.kind === "amount" && !used.has(col.index))) {
      offer("amount", withColumns(layout, { amount: col.index }), true);
    }
  }
  // An amount column the guess left out, filled exactly where the guessed one is empty ("Betrag Soll", "Betrag
  // Haben"): the two are money out and money in. The one with minus signs is money out; else the left one, as German
  // exports put Soll before Haben.
  if (c.amount !== undefined && c.sign === undefined) {
    const amounts = (j: number) => columns[j].values.map((v) => parseAmountStrict(v, layout.numberFormat));
    for (const col of columns.filter((col) => col.kind === "amount" && !used.has(col.index))) {
      if (!complementary(amounts(c.amount), amounts(col.index))) continue;
      const [left, right] = [c.amount, col.index].sort((a, b) => a - b);
      const minus = (j: number) => amounts(j).filter((v) => v !== null && !/^-?0\.0+$/.test(v)).every((v) => v!.startsWith("-"));
      const [debit, credit] = minus(right) && !minus(left) ? [right, left] : [left, right];
      const pair = { amount: undefined, debit, credit };
      offer("debitCredit", withColumns(layout, pair), true);
      offer("debitCredit", withColumns(layout, { ...pair, debit: credit, credit: debit }), true);
    }
  }

  if (c.amount !== undefined && c.sign === undefined) {
    // A column of marks the reader understands, with money out and money in both in it.
    for (const col of columns.filter((col) => col.index !== c.date && col.index !== c.amount)) {
      const marks = col.values.filter((v) => v.trim() !== "").map(signMark);
      if (marks.length > 0 && marks.every(Boolean) && marks.includes("debit") && marks.includes("credit")) {
        offer("sign", withColumns(layout, { sign: col.index }), unsure.has("sign"));
      }
    }
    // A balance that moves by the amounts proves their direction; without one, the amounts may be the other way round.
    const proven = c.balance !== undefined
      && balanceFits(guessed.map((t) => t.amount), guessed.map((t) => t.balance ?? null)) >= 0.8;
    if (!proven) offer("invertSign", { ...layout, invertSign: true }, unsure.has("sign"));
  }

  const party = c.counterparty, text = c.text;
  const unsureText = unsure.has("text") || unsure.has("counterparty");
  if (party?.length && text?.length) offer("counterpartyText", withColumns(layout, { counterparty: text, text: party }), unsureText);
  else if (text?.length) {
    // No column for the other party: the text column may be it, with another text column as the text; or another
    // text column (the longest) may be the other party.
    const longest = [...freeText].sort((a, b) => average(b) - average(a))[0];
    offer("counterpartyText", withColumns(layout, { counterparty: text, text: longest ? [longest.index] : undefined }), unsureText);
    if (longest) offer("counterparty", withColumns(layout, { counterparty: [longest.index] }), unsureText);
  } else if (party?.length) offer("counterpartyText", withColumns(layout, { counterparty: undefined, text: party }), unsureText);

  if (c.valueDate !== undefined) offer("valueDate", withColumns(layout, { date: c.valueDate, valueDate: c.date }), unsure.has("date"));

  const rank = (x: Candidate) => (x.doubted ? 0 : ORDER.length) + ORDER.indexOf(x.reason);
  return out.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map(({ x }) => x);
}

const average = (col: AnalysedColumn) => col.values.reduce((n, v) => n + v.length, 0) / Math.max(col.values.length, 1);

// What the person sees of a payment: its day, the other party, the text and the amount.
const shown = (preview: BankTxn[]) => JSON.stringify(preview.map((t) => [t.bookingDate.slice(0, 10), t.counterparty ?? "", t.description, t.amount]));

// The readings of an unknown CSV's text, best first; [] when the file is not an unknown CSV (CAMT, MT940, PayPal, a
// known bank with unambiguous dates or one of `savedLayouts`: read it with readBankText) or no layout with a date and an amount was found
// (the person picks the columns from LayoutGuess.columns).
export function readingsOfUnknownText(text: string, savedLayouts: readonly CsvLayout[] = []): FileReading[] {
  const clean = text.replace(/^\uFEFF/, "");
  const detected = detectBankFile(clean, savedLayouts);
  if (detected.format !== "csv") return [];
  if (detected.layout) {
    if (!detected.dateAmbiguous) return [];
    const rows = checkedCsvRows(clean, detected.separator);
    const first = dateConfirmation(rows, detected.headerRow, detected.layout).layout!;
    return [first, { ...first, dateFormat: OTHER_DAY_ORDER[first.dateFormat]! }].map((layout, i) => ({
      layout, reason: i === 0 ? null : "dateFormat",
      preview: readTable(rows, detected.headerRow, layout).transactions.slice(0, PREVIEW_PAYMENTS),
    }));
  }
  const { guess, columns, rows, payments: guessed } = analyseCsv(clean);
  if (!guess.layout) return [];
  // Each layout read the way the import will read it once saved: its table found by its header (or shape) again.
  const read = (layout: CsvLayout): BankTxn[] => {
    const start = findTable(rows, layout);
    if (start === null) return [];
    try { return readTable(rows, start, layout).transactions; }
    catch (error) {
      if (error instanceof BankFileError) return [];
      throw error;
    }
  };
  const candidates = [
    { layout: guess.layout, reason: null, payments: guessed },
    ...alternatives({ ...guess, layout: guess.layout }, columns, guessed).map((x) => ({ ...x, payments: read(x.layout) })),
  ];
  // A reading that loses payments another one reads does not read the file (rows whose date or amount it cannot read).
  const most = Math.max(...candidates.map((x) => x.payments.length));
  const readings: FileReading[] = [];
  const seen = new Set<string>();
  for (const { layout, reason, payments } of candidates) {
    if (payments.length === 0 || payments.length < most) continue;
    const preview = payments.slice(0, PREVIEW_PAYMENTS);
    const key = shown(preview);
    if (seen.has(key)) continue; // looks the same as an earlier reading
    seen.add(key);
    readings.push({ layout, reason, preview });
    if (readings.length === MAX_READINGS) break;
  }
  return readings;
}

// The readings of an unknown bank CSV from its bytes (see readingsOfUnknownText). Call it after readBankFile came back
// with `needsLayout`; save the layout the person confirms (with a name) and read the file again with it.
export function readingsOfUnknownFile(bytes: ArrayLike<number>, savedLayouts: readonly CsvLayout[] = []): FileReading[] {
  let text: string;
  try { text = bankTableText(bytes, savedLayouts); }
  catch (error) {
    // Readings are optional suggestions. The import reports any container error through readBankFile.
    if (error instanceof BankFileError) return [];
    throw error;
  }
  return readingsOfUnknownText(text, savedLayouts);
}
