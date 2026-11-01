// Finding the layout of an unknown bank CSV from its values, helped by the header words (German and English).
// No AI and nothing leaves the phone: a column is a date column when its cells are dates, an amount column when
// they are amounts, a balance when it moves by exactly the amounts, and so on. The header words then tell the
// booking date from the value date, the payment text from the counterparty. The person sees the first rows read
// this way and confirms or changes a column once; the app saves the layout for the next file.
import { detectSeparator, type Separator } from "./csv.js";
import { BankFileError, checkedCsvRows, readTable, trimRow } from "./table.js";
import {
  addAmounts, DATE_FORMATS, headerKey, normalizeIban, parseAmountStrict, parseDate, sameAmount,
  type DateFormat, type NumberFormat,
} from "./values.js";
import type { BankTxn, ColumnInfo, ColumnKind, CsvLayout, LayoutGuess } from "./types.js";

type Role = "date" | "valueDate" | "amount" | "debit" | "credit" | "balance" | "counterparty" | "text" | "kind"
  | "iban" | "accountIban" | "currency" | "reference" | "status";

// Header words per role, compared as header keys (lower case, umlauts spelled out, no punctuation). The
// longest word that fits decides, so "Buchungstext" is the booking type, not a date ("buchung") or text ("text").
const WORDS: Record<Role, string[]> = {
  date: ["buchungstag", "buchungsdatum", "buchung", "datum", "date", "bookingdate", "completeddate", "transactiondate",
    "umsatztag", "belegdatum", "booked", "tag"],
  valueDate: ["valuta", "valutadatum", "wertstellung", "wert", "valuedate"],
  amount: ["betrag", "umsatz", "amount", "summe", "value", "total", "betrageur", "amounteur"],
  debit: ["soll", "belastung", "debit", "ausgang", "ausgabe", "moneyout", "paidout", "withdrawal", "lastschrift"],
  credit: ["haben", "gutschrift", "credit", "eingang", "einnahme", "moneyin", "paidin", "deposit"],
  balance: ["saldo", "kontostand", "balance", "guthaben", "saldonachbuchung", "runningbalance"],
  counterparty: ["zahlungsbeteiligter", "namezahlungsbeteiligter", "beguenstigter", "zahlungspflichtiger", "empfaenger",
    "auftraggeber", "name", "payee", "payer", "partner", "partnername", "merchant", "counterparty", "haendler",
    "gegenpartei", "gegenseite", "beguenstigterzahlungspflichtiger", "auftraggeberempfaenger", "recipient", "sender"],
  text: ["verwendungszweck", "zweck", "purpose", "reference", "paymentreference", "referenz", "memo", "description",
    "beschreibung", "details", "buchungsdetails", "text", "notes", "notiz", "betreff", "vorgangverwendungszweck",
    "information", "buchungsinformation"],
  kind: ["buchungstext", "umsatzart", "vorgang", "type", "transactiontype", "art", "buchungsart", "umsatztyp", "typ"],
  iban: ["iban", "kontonummer", "accountnumber", "konto", "partneriban", "ibanzahlungsbeteiligter", "kontonummeriban"],
  accountIban: ["auftragskonto", "ibanauftragskonto", "eigeneiban", "ownaccount"],
  currency: ["waehrung", "currency", "ccy"],
  reference: ["transactionid", "transaktionsid", "transaktionscode", "referenznummer", "buchungsreferenz", "id"],
  status: ["status", "state", "zustand", "info"],
};

function wordScore(header: string, role: Role): number {
  const key = headerKey(header);
  let best = 0;
  for (const word of WORDS[role]) {
    // Short words must be the whole name ("id", "art", "tag", "soll", "typ"; "Soll (EUR)" too), longer ones may
    // be part of it.
    const fits = word.length <= 4 ? key === word || key === `${word}eur` : key.includes(word);
    if (fits && word.length > best) best = word.length;
  }
  return best;
}

const hasLetter = (v: string) => /\p{L}/u.test(v);
const DE_DECIMAL = /\d,\d{1,2}(?!\d)/;
const EN_DECIMAL = /\d\.\d{1,2}(?!\d)/;
const isDateLike = (v: string) => DATE_FORMATS.some((f) => parseDate(v, f) !== null);
const SIGN_VALUE = /^(s|h|soll|haben|d|c|db|cr|dbit|crdt|debit|credit|\+|-)$/i;

// The header row: the first line, among the first 60, with three or more cells that are all words, followed by a
// line with a date in it. Lines above it are the account details some banks put there.
function findHeader(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const cells = trimRow(rows[i]);
    // Planning tables contain dates and amounts too, but they are not booked payments.
    if (cells.some((v) => /^(plannedamount|forecastamount|budgetamount)/.test(headerKey(v)))) continue;
    const filled = cells.filter(Boolean);
    if (filled.length < 3 || filled.length < cells.length * 0.6) continue;
    if (!filled.every((v) => hasLetter(v) && !isDateLike(v) && !DE_DECIMAL.test(v) && !EN_DECIMAL.test(v))) continue;
    const next = rows.slice(i + 1, i + 6).map(trimRow).filter((r) => r.length > 0);
    if (next.some((r) => r.length >= cells.length - 2 && r.some(isDateLike))) return i;
  }
  return -1;
}

function bestDateFormat(values: string[]): { format: DateFormat; share: number; ambiguous: boolean } {
  let best: DateFormat = "DD.MM.YYYY", share = 0;
  const full: DateFormat[] = [];
  for (const format of DATE_FORMATS) {
    const ok = values.filter((v) => parseDate(v, format) !== null).length / Math.max(values.length, 1);
    if (ok > share) { best = format; share = ok; }
    if (ok === 1) full.push(format);
  }
  // Day and month both ≤ 12 everywhere: DD/MM and MM/DD both fit. The one that keeps the rows in order wins
  // (exports are sorted by date); with no difference, the German order.
  let ambiguous = false;
  if (full.includes("DD/MM/YYYY") && full.includes("MM/DD/YYYY")) {
    const sorted = (format: DateFormat) => {
      const dates = values.map((v) => parseDate(v, format)!);
      const up = dates.every((d, i) => i === 0 || dates[i - 1] <= d), down = dates.every((d, i) => i === 0 || dates[i - 1] >= d);
      return up || down;
    };
    const dm = sorted("DD/MM/YYYY"), md = sorted("MM/DD/YYYY");
    best = md && !dm ? "MM/DD/YYYY" : "DD/MM/YYYY";
    ambiguous = true; // row order ranks previews but cannot prove the date order
  }
  return { format: best, share, ambiguous };
}

// The balance column moves by exactly the amount from row to row, whichever way the rows are sorted. The share of
// row pairs that fit (0–1).
export function balanceFits(amounts: (string | null)[], balances: (string | null)[]): number {
  let fits = 0, pairs = 0;
  for (let i = 1; i < amounts.length; i++) {
    const a0 = amounts[i - 1], a1 = amounts[i], b0 = balances[i - 1], b1 = balances[i];
    if (!a0 || !a1 || !b0 || !b1) continue;
    pairs++;
    if (sameAmount(addAmounts(b0, a1), b1) || sameAmount(addAmounts(b1, a0), b0)) fits++;
  }
  return pairs === 0 ? 0 : fits / pairs;
}

const filledAmount = (v: string | null) => v !== null && !/^-?0\.0+$/.test(v);

// Two amount columns that are never both filled in one row, and each filled somewhere.
export function complementary(a: (string | null)[], b: (string | null)[]): boolean {
  return !a.some((v, i) => filledAmount(v) && filledAmount(b[i])) && a.some(filledAmount) && b.some(filledAmount);
}

// One signed amount per row from a money-out and a money-in column.
function outAndIn(out: (string | null)[], inn: (string | null)[]): (string | null)[] {
  return out.map((v, i) => (filledAmount(v) ? `-${v!.replace(/^-/, "")}` : filledAmount(inn[i]) ? inn[i]!.replace(/^-/, "") : null));
}

// Where the table starts: its header row, or (headerRow -1) a file without one that starts with its payments,
// each row with a date and an amount (Targobank).
export function findTableStart(rows: string[][]): { headerRow: number; width: number } | null {
  const headerRow = findHeader(rows);
  if (headerRow >= 0) return { headerRow, width: trimRow(rows[headerRow]).length };
  const filled = rows.filter((r) => r.some((v) => v.trim() !== ""));
  const sample = filled.slice(0, 5);
  const width = sample[0]?.length ?? 0;
  const isData = (r: string[]) => r.length === width && trimRow(r).length >= 3 && r.some(isDateLike)
    && r.some((v) => !isDateLike(v) && (DE_DECIMAL.test(v) || EN_DECIMAL.test(v)));
  return sample.length > 0 && sample.every(isData) ? { headerRow: -1, width } : null;
}

// A column as the guesser saw it, with the values from every row that has a date.
export type AnalysedColumn = ColumnInfo & { values: string[]; ambiguous?: boolean };

// What the guesser worked out: its guess, the columns it was made from, the file's rows and every payment the guessed
// layout reads (empty without a layout). The other readings of an unknown file (readings.ts) start from these.
export type CsvAnalysis = { guess: LayoutGuess; columns: AnalysedColumn[]; rows: string[][]; payments: BankTxn[] };

// Guesses the layout of a CSV export from its values and header words; see LayoutGuess.
export function guessCsvLayout(text: string): LayoutGuess {
  return analyseCsv(text).guess;
}

// The guess with the columns behind it.
export function analyseCsv(text: string): CsvAnalysis {
  const separator: Separator = detectSeparator(text);
  const rows = checkedCsvRows(text, separator);
  const table = findTableStart(rows);
  if (!table) throw new BankFileError("noTable", "No table with a header row and dates was found in this file.");
  const { headerRow, width } = table;
  const header = headerRow >= 0 ? trimRow(rows[headerRow]) : [];
  const names = headerRow >= 0 ? header : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  const data = rows.slice(headerRow + 1).map(trimRow)
    .filter((r) => r.length >= Math.ceil(width / 2) && r.some(isDateLike));
  const column = (j: number) => data.map((r) => r[j] ?? "");

  // Decimal comma or point: whichever the non-date cells use more.
  let de = 0, en = 0;
  for (const r of data) for (const v of r) {
    if (isDateLike(v)) continue;
    if (DE_DECIMAL.test(v)) de++;
    if (EN_DECIMAL.test(v)) en++;
  }
  const numberFormat: NumberFormat = en > de ? "en" : "de";
  const decimalMark = numberFormat === "de" ? DE_DECIMAL : EN_DECIMAL;

  const columns: AnalysedColumn[] = [];
  for (let j = 0; j < width; j++) {
    const all = column(j), values = all.filter(Boolean);
    let kind: ColumnKind = "text";
    let dateFormat: DateFormat | undefined, ambiguous = false;
    if (values.length === 0) kind = "empty";
    else {
      const date = bestDateFormat(values);
      const amounts = values.filter((v) => parseAmountStrict(v, numberFormat) !== null).length / values.length;
      const decimals = values.filter((v) => decimalMark.test(v)).length / values.length;
      if (date.share >= 0.9) { kind = "date"; dateFormat = date.format; ambiguous = date.ambiguous; }
      else if (values.filter((v) => normalizeIban(v)).length / values.length >= 0.8) kind = "iban";
      else if (amounts >= 0.9 && decimals >= 0.5) kind = "amount";
      else if (values.every((v) => SIGN_VALUE.test(v)) && new Set(values.map((v) => v.toLowerCase())).size <= 4) kind = "sign";
      else if (values.every((v) => /^[A-Z]{3}$/.test(v)) && new Set(values).size <= 3) kind = "currency";
      else if (values.every((v) => /^[\d\s/-]+$/.test(v))) kind = "number";
    }
    columns.push({ index: j, header: names[j], kind, samples: values.slice(0, 3), values: all, dateFormat, ambiguous });
  }

  const roles: Partial<Record<Role, number>> = {};
  const unsure = new Set<string>();
  const taken = new Set<number>();
  const take = (role: Role, j: number) => { roles[role] = j; taken.add(j); };
  const byWord = (role: Role, kinds: ColumnKind[]) => columns
    .filter((col) => !taken.has(col.index) && kinds.includes(col.kind) && wordScore(col.header, role) > 0)
    .sort((a, b) => wordScore(b.header, role) - wordScore(a.header, role))[0];

  // Dates: the booking date by its words (else the first date column), then the value date.
  const dates = columns.filter((col) => col.kind === "date");
  const booking = [...dates].sort((a, b) =>
    (wordScore(b.header, "date") - wordScore(b.header, "valueDate")) - (wordScore(a.header, "date") - wordScore(a.header, "valueDate"))
    || a.index - b.index)[0];
  if (booking) {
    take("date", booking.index);
    if (wordScore(booking.header, "date") === 0) unsure.add("date");
    const value = dates.find((col) => col !== booking && wordScore(col.header, "valueDate") > 0) ?? dates.find((col) => col !== booking);
    if (value) take("valueDate", value.index);
  }

  // Amounts: balance, amount, debit and credit by their words; without words, by the values: the balance is the
  // column that moves by another column's amounts, and two amount columns never filled in the same row are money
  // out and money in (the balance, or the minus signs, tell which is which).
  const amountCols = columns.filter((col) => col.kind === "amount");
  const parsed = (j: number) => columns[j].values.map((v) => parseAmountStrict(v, numberFormat));
  const balanceWord = byWord("balance", ["amount"]);
  if (balanceWord) take("balance", balanceWord.index);
  const debitWord = byWord("debit", ["amount"]), creditWord = byWord("credit", ["amount"]);
  const amountWord = byWord("amount", ["amount"]);
  if (amountWord) take("amount", amountWord.index);
  else if (debitWord && creditWord) { take("debit", debitWord.index); take("credit", creditWord.index); }
  else {
    let rest = amountCols.filter((col) => !taken.has(col.index));
    if (roles.balance === undefined) {
      // The balance moves by one amount column, or by two (money out and money in) taken together.
      const movesBy = (b: number) => rest.some((a) => a.index !== b && balanceFits(parsed(a.index), parsed(b)) >= 0.8)
        || rest.some((x) => rest.some((y) => x !== y && x.index !== b && y.index !== b
          && complementary(parsed(x.index), parsed(y.index)) && balanceFits(outAndIn(parsed(x.index), parsed(y.index)), parsed(b)) >= 0.8));
      const moving = rest.find((col) => movesBy(col.index));
      if (moving) { take("balance", moving.index); rest = rest.filter((col) => col !== moving); }
    }
    const pair = rest.length === 2 ? debitCredit(rest[0].index, rest[1].index) : null;
    if (pair) {
      take("debit", pair.debit); take("credit", pair.credit);
      if (!pair.sure) unsure.add("amount");
    } else {
      const balanceCol = roles.balance;
      const fitting = balanceCol !== undefined ? rest.find((col) => balanceFits(parsed(col.index), parsed(balanceCol)) >= 0.8) : undefined;
      if (fitting) take("amount", fitting.index);
      else if (rest[0]) { take("amount", rest[0].index); unsure.add("amount"); }
    }
  }
  if (roles.balance === undefined && roles.amount !== undefined) {
    const fitting = amountCols.find((col) => !taken.has(col.index) && balanceFits(parsed(roles.amount!), parsed(col.index)) >= 0.8);
    if (fitting) take("balance", fitting.index);
  }

  // Two columns that are never both filled in one row: which is money out?
  function debitCredit(a: number, b: number): { debit: number; credit: number; sure: boolean } | null {
    const pa = parsed(a), pb = parsed(b);
    if (!complementary(pa, pb)) return null;
    if (debitWord?.index === a || creditWord?.index === b) return { debit: a, credit: b, sure: true };
    if (debitWord?.index === b || creditWord?.index === a) return { debit: b, credit: a, sure: true };
    if (roles.balance !== undefined) {
      const balance = parsed(roles.balance);
      if (balanceFits(outAndIn(pa, pb), balance) >= 0.8) return { debit: a, credit: b, sure: true };
      if (balanceFits(outAndIn(pb, pa), balance) >= 0.8) return { debit: b, credit: a, sure: true };
    }
    if (pa.filter(filledAmount).every((v) => v!.startsWith("-"))) return { debit: a, credit: b, sure: true };
    if (pb.filter(filledAmount).every((v) => v!.startsWith("-"))) return { debit: b, credit: a, sure: true };
    return { debit: a, credit: b, sure: false }; // German exports put "Soll" before "Haben"
  }

  // A sign column (S/H) when the amounts carry no sign themselves.
  const sign = columns.find((col) => col.kind === "sign");
  const anyNegative = roles.amount !== undefined && parsed(roles.amount).some((a) => a?.startsWith("-"));
  if (sign && roles.amount !== undefined && !anyNegative) taken.add(sign.index);
  else if (roles.amount !== undefined && !anyNegative) unsure.add("sign");

  // IBANs: the same IBAN in every row is the account's own; otherwise the other party's.
  for (const col of columns.filter((c) => c.kind === "iban" && !taken.has(c.index))) {
    const distinct = new Set(col.values.filter(Boolean).map((v) => v.replace(/\s/g, "")));
    if ((distinct.size === 1 && data.length > 1) || wordScore(col.header, "accountIban") > 0) {
      if (roles.accountIban === undefined) take("accountIban", col.index);
    } else if (roles.iban === undefined) take("iban", col.index);
  }
  const currency = byWord("currency", ["currency", "text"]) ?? columns.find((col) => col.kind === "currency" && !taken.has(col.index));
  if (currency) take("currency", currency.index);

  // Words for the rest.
  const status = byWord("status", ["text"]);
  if (status && new Set(status.values).size <= 6) take("status", status.index);
  const reference = byWord("reference", ["text", "number"]);
  if (reference && new Set(reference.values.filter(Boolean)).size === reference.values.filter(Boolean).length) take("reference", reference.index);
  const bookingType = (col: AnalysedColumn) => col.values.filter(Boolean).every((v) =>
    /^(lastschrift|sepa.lastschrift|überweisung|sepa.überweisung|gutschrift|kartenzahlung|kartenverfügung|dauerauftrag|card payment|transfer)$/i.test(v.trim()));
  // A purpose word can be part of a type word ("Vorgang/Verwendungszweck"). Assign explicit purposes first.
  // Conversely, where both Umsatzart and Buchungstext exist, short booking-type values identify the type;
  // the longer purpose text must stay available for sorting.
  const purpose = columns.filter((col) => col.kind === "text" && !taken.has(col.index)
    && wordScore(col.header, "text") > wordScore(col.header, "kind") && wordScore(col.header, "text") > 0)
    .sort((a, b) => wordScore(b.header, "text") - wordScore(a.header, "text"))[0];
  if (purpose) take("text", purpose.index);
  const type = columns.filter((col) => col.kind === "text" && !taken.has(col.index)
    && wordScore(col.header, "kind") > 0 && bookingType(col))
    .sort((a, b) => wordScore(b.header, "kind") - wordScore(a.header, "kind"))[0];
  if (type) take("kind", type.index);
  for (const role of ["kind", "counterparty", "text"] as const) {
    if (roles[role] !== undefined) continue;
    const col = byWord(role, ["text"]);
    if (col) take(role, col.index);
  }
  // No text column by its words: the free text column with the longest cells.
  const freeText = columns.filter((col) => col.kind === "text" && !taken.has(col.index));
  const avg = (col: (typeof columns)[number]) => col.values.reduce((n, v) => n + v.length, 0) / Math.max(col.values.length, 1);
  if (roles.text === undefined) {
    const longest = [...freeText].sort((a, b) => avg(b) - avg(a))[0];
    if (longest) { take("text", longest.index); unsure.add("text"); }
  }
  if (roles.counterparty === undefined) unsure.add("counterparty");

  const missing: string[] = [];
  if (roles.date === undefined) missing.push("date");
  if (roles.amount === undefined && (roles.debit === undefined || roles.credit === undefined)) missing.push("amount");
  const info: ColumnInfo[] = columns.map(({ index, header: h, kind, samples, dateFormat: f }) =>
    ({ index, header: h, kind, samples, ...(f ? { dateFormat: f } : {}) }));
  const dateCol = roles.date !== undefined ? columns[roles.date] : undefined;
  const dateFormat = dateCol?.dateFormat ?? "DD.MM.YYYY";
  if (dateCol?.ambiguous) unsure.add("dateFormat");
  if (missing.length > 0) {
    return {
      guess: { layout: null, confidence: 0, unsure: [...unsure], missing, separator, header, headerRow, columns: info, preview: [] },
      columns,
      rows,
      payments: [],
    };
  }

  const layout: CsvLayout = {
    version: 1,
    separator,
    header,
    ...(headerRow < 0 ? { columnCount: width } : {}),
    dateFormat,
    numberFormat,
    columns: {
      date: roles.date!,
      ...(roles.valueDate !== undefined ? { valueDate: roles.valueDate } : {}),
      ...(roles.amount !== undefined ? { amount: roles.amount } : { debit: roles.debit, credit: roles.credit }),
      ...(sign && roles.amount !== undefined && !anyNegative ? { sign: sign.index } : {}),
      ...(roles.counterparty !== undefined ? { counterparty: [roles.counterparty] } : {}),
      ...(roles.text !== undefined ? { text: [roles.text] } : {}),
      ...(roles.kind !== undefined ? { kind: roles.kind } : {}),
      ...(roles.iban !== undefined ? { iban: roles.iban } : {}),
      ...(roles.accountIban !== undefined ? { accountIban: roles.accountIban } : {}),
      ...(roles.balance !== undefined ? { balance: roles.balance } : {}),
      ...(roles.currency !== undefined ? { currency: roles.currency } : {}),
      ...(roles.reference !== undefined ? { reference: roles.reference } : {}),
      ...(roles.status !== undefined ? { status: roles.status } : {}),
    },
    ...(roles.status !== undefined ? { skipStatus: ["vorgemerkt", "pending", "offen", "reverted", "declined", "failed", "storniert"] } : {}),
  };

  const read = readTable(rows, headerRow, layout);
  const rowsRead = read.transactions.length / Math.max(data.length, 1);
  let confidence = Math.min(1, rowsRead);
  if (unsure.has("date")) confidence *= 0.85;
  if (unsure.has("dateFormat")) confidence *= 0.7;
  if (unsure.has("amount")) confidence *= 0.75;
  if (unsure.has("sign")) confidence *= 0.7;
  if (unsure.has("text")) confidence *= 0.9;
  if (unsure.has("counterparty")) confidence *= 0.9;
  return {
    guess: {
      layout,
      confidence: Math.round(confidence * 100) / 100,
      unsure: [...unsure],
      missing,
      separator,
      header,
      headerRow,
      columns: info,
      preview: read.transactions.slice(0, 5),
    },
    columns,
    rows,
    payments: read.transactions,
  };
}
