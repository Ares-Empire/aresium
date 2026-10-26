// This boundary is JSON-only. The server parsers still return Date objects;
// these thin wrappers expose bookingDate/valueDate as UTC ISO strings instead.
import { parseVrBankCsv as vrBank } from "../import/vrbank-csv.js";
import { parseCamt as camt } from "../import/camt.js";
import { parsePaypalCsv as paypal } from "../import/paypal-csv.js";
import type { NormalizedTxn, ParsedFile } from "../import/types.js";

export { buildDashboard } from "../data/dashboard.js";
export { DEFAULT_CATEGORIES, BUILT_IN_CATEGORIES } from "./categories.js";
export type { Category, CategoryKind } from "./categories.js";
export { merchantKey } from "./sorting/merchant.js";
export type { SortingPayment } from "./sorting/merchant.js";
export { STARTER_RULES, starterCategory } from "./sorting/starter-rules.js";
export { sortPayments, learn } from "./sorting/sort.js";
export type { Learned, SortResult } from "./sorting/sort.js";
export const version = "0.1.0";

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
