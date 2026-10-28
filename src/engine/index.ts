// This boundary is JSON-only. The server parsers still return Date objects;
// these thin wrappers expose bookingDate/valueDate as UTC ISO strings instead.
import { parseVrBankCsv as vrBank } from "../import/vrbank-csv.js";
import { parseCamt as camt } from "../import/camt.js";
import { parsePaypalCsv as paypal } from "../import/paypal-csv.js";
import type { NormalizedTxn, ParsedFile } from "../import/types.js";

export { buildDashboard } from "../data/dashboard.js";
export { DEFAULT_CATEGORIES, BUILT_IN_CATEGORIES, CATEGORY_LOOK, CUSTOM_CATEGORY_LOOK, categoryLook } from "./categories.js";
export type { Category, CategoryKind, CategoryLook } from "./categories.js";
export { merchantKey } from "./sorting/merchant.js";
export type { SortingPayment } from "./sorting/merchant.js";
export { STARTER_RULES, starterCategory } from "./sorting/starter-rules.js";
export { sortPayments, learn } from "./sorting/sort.js";
export type { Learned, SortResult } from "./sorting/sort.js";
export const version = "0.1.0";

// ---- Dashboard source and own transfers (brief 12) ----
export { buildDashboardSource } from "./source.js";
export type { DashboardSourceInput, SourcePayment, SourceCategory, SourceReceipt } from "./source.js";
export { ownTransfers, OWN_TRANSFERS } from "./sorting/transfers.js";
export type { TransferPayment, OwnTransfer } from "./sorting/transfers.js";
// ---- end of brief 12's block ----

type EngineTxn = Omit<NormalizedTxn, "bookingDate" | "valueDate"> & {
  bookingDate: string;
  valueDate?: string | null;
};
type EngineFile = Omit<ParsedFile, "transactions"> & { transactions: EngineTxn[] };
function isoDates(file: ParsedFile): EngineFile {
  return {
    ...file,
    transactions: file.transactions.map(({ bookingDate, valueDate, ...txn }) => ({
      ...txn,
      bookingDate: bookingDate.toISOString(),
      ...(valueDate === undefined ? {} : { valueDate: valueDate?.toISOString() ?? null }),
    })),
  };
}
export const parseVrBankCsv = (text: string): EngineFile => isoDates(vrBank(text));
export const parseCamt = (text: string): EngineFile => isoDates(camt(text));
export const parsePaypalCsv = (text: string): EngineFile => isoDates(paypal(text));

// ── Bank files (brief 14): any bank's CSV, CAMT or MT940, read on the phone ──────────────────────────────
export { decodeBankFile } from "./readers/decode.js";
export { detectBankFile, readBankFile, readBankText } from "./readers/read.js";
export type { Detection } from "./readers/read.js";
export { readCsv } from "./readers/table.js";
export { guessCsvLayout } from "./readers/guess.js";
export { readCamt } from "./readers/camt.js";
export { readMt940 } from "./readers/mt940.js";
export { BANK_PROFILES } from "./readers/profiles.js";
export type { BankProfile } from "./readers/profiles.js";
export type { BankFile, BankTxn, CsvLayout, LayoutGuess, ColumnInfo } from "./readers/types.js";
// ── end of bank files ─────────────────────────────────────────────────────────────────────────────────────

// ── Unknown banks (brief 20): readings to choose from, and a layout people can send us ──────────────────────
export { readingsOfUnknownFile } from "./readers/readings.js";
export type { FileReading, ReadingReason } from "./readers/readings.js";
export { shareableLayout } from "./readers/share.js";
export type { ShareableLayout, NotShareable } from "./readers/share.js";
// ── end of unknown banks ──────────────────────────────────────────────────────────────────────────────────

// ── Receipts (brief 30): read a receipt, find its bank payment; buildDashboardSource counts them (`receipts`) ──
export { readReceipt } from "./receipts/read.js";
export type { ReceiptInput, ReceiptReading, Observation, Language } from "./receipts/read.js";
export { matchReceipt } from "./receipts/match.js";
export type { MatchReceipt, MatchPayment, ReceiptMatch, ReceiptCandidate, CandidateReason } from "./receipts/match.js";
export type { ReceiptMarks } from "../data/dashboard.js";
// Cash beyond the bank (brief 32): `SourceReceipt` takes `direction`, `kind` and `paidFrom`; the dashboard's `cash`.
export type { CashView, CashMonth, CashMovement } from "../data/dashboard.js";
// ── end of receipts ───────────────────────────────────────────────────────────────────────────────────────
