// What the bank-file readers return: plain JSON, so the iPhone app can take it straight from JavaScriptCore.
import type { NormalizedTxn } from "../../import/types.js";
import type { DateFormat, NumberFormat } from "./values.js";
import type { Separator } from "./csv.js";

// NormalizedTxn with its dates as ISO strings (midnight UTC for a date without a time).
export type BankTxn = Omit<NormalizedTxn, "bookingDate" | "valueDate"> & {
  bookingDate: string;
  valueDate?: string | null;
};

export type BankFormat = "camt" | "mt940" | "paypal" | "csv";

// A CSV table's layout: which column holds what, and how to read it. Columns are counted from 0 in the header
// row. Plain JSON: the app saves a confirmed layout and passes it back with the next file of that bank, which is
// recognised by its header row.
export type CsvLayout = {
  version: 1;
  name?: string; // the bank's name, or what the person called it
  profile?: string; // the known profile this came from
  separator: Separator;
  header: string[]; // the header row's cells, which find the table and recognise the next file; [] for a file
  // without a header row (Targobank), which is recognised by its width and a date in the date column
  columnCount?: number; // the rows' number of cells, for a file without a header row
  dateFormat: DateFormat;
  numberFormat: NumberFormat;
  columns: {
    date: number; // booking date
    valueDate?: number;
    amount?: number; // one signed amount column, or debit and credit
    debit?: number; // money out (its sign is ignored)
    credit?: number; // money in (its sign is ignored)
    sign?: number; // a marker column: S/H, Soll/Haben, D/C, Debit/Credit (needs `amount`)
    counterparty?: number[]; // the other party, whichever way the money went: the first of these cells that is filled
    payer?: number; // for banks with a payer and a payee column: the other party on money in
    payee?: number; // ... and on money out
    text?: number[]; // the payment text, joined with spaces
    kind?: number; // the booking type ("Lastschrift", "Card payment"), the text when there is none
    iban?: number; // the other party's IBAN
    accountIban?: number; // the account's own IBAN, in each row
    balance?: number; // balance after the booking
    currency?: number;
    reference?: number; // the bank's own unique id for the booking
    status?: number; // booked or pending
    fees?: number[]; // charges in their own column, taken off the amount (their sign is ignored)
    addAmounts?: number[]; // further signed amounts that belong to the payment (Trade Republic's fee and tax)
  };
  skipStatus?: string[]; // rows whose status contains one of these words are not booked yet (lower case)
  keepStatus?: string[]; // or: only rows whose status contains one of these words are booked
  invertSign?: boolean; // credit cards that show spending as positive amounts
  // One text cell holding labelled parts (comdirect: "Empfänger: … Kto/IBAN: … Buchungstext: …"): the
  // counterparty is the part after the first `counterparty` label found, the text the part after a `text` label
  // ("" for the part before the first label); every label in `labels` ends the part before it.
  labelledText?: { labels: string[]; counterparty: string[]; text: string[] };
  currency?: string; // when no column says (default EUR)
};

export type ColumnKind = "date" | "amount" | "iban" | "sign" | "currency" | "text" | "number" | "empty";

// What the guesser saw in one column, for the app's "change a column" picker.
export type ColumnInfo = { index: number; header: string; kind: ColumnKind; samples: string[]; dateFormat?: DateFormat };

export type LayoutGuess = {
  layout: CsvLayout | null; // null when no date or amount column was found (see `missing`)
  confidence: number; // 0–1: how sure the guess is; the person confirms it either way
  unsure: string[]; // found only weakly: "date", "dateFormat", "amount", "sign", "text", "counterparty"
  missing: string[]; // required and not found: "date", "amount"; the person picks them from `columns`
  separator: Separator; // with `header`, what the app needs to build a layout the person picked by hand
  header: string[];
  headerRow: number; // the header's line in the file, counted from 0
  columns: ColumnInfo[];
  preview: BankTxn[]; // the first rows read with the guessed layout
};

export type BankAccount = { iban?: string; name?: string; currency?: string };

export type BankFile = {
  format: BankFormat;
  bank?: { id: string; name: string }; // the known layout or bank, when recognised
  account?: BankAccount;
  transactions: BankTxn[];
  skipped?: number; // rows that were not booked payments (pending, totals, empty)
  layout?: CsvLayout; // the CSV layout used, for the app to save or show
  encoding?: string;
  needsLayout?: LayoutGuess; // an unknown CSV: confirm a layout, then read again with it
};
