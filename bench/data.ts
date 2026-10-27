import categoryMap from "./category-map.json" with { type: "json" };
export const CATEGORY_MAP: Readonly<Record<string, readonly string[] | null>> = categoryMap;
export type BenchPayment = {
  reference: string; date: string; amount: number; description: string; counterparty: string | null; trueCategory: string;
  // What the structural rules (own transfers) need; an export without them sorts every payment on its own text.
  // Accounts and IBANs are local aliases ("account-1", "iban-1"), never the real values.
  source?: "bank" | "paypal"; currency?: string; account?: string; accountIban?: string | null; counterpartyIban?: string | null;
};
export const DATA_FILE = new URL("out/data.json", import.meta.url);
export const RESULTS_FILE = new URL("out/results.md", import.meta.url);

const optional = (value: unknown, valid: (v: unknown) => boolean) => value === undefined || valid(value);
const text = (v: unknown) => typeof v === "string" && v !== "";
const textOrNull = (v: unknown) => v === null || text(v);

// Fail closed without including any offending values in error messages.
export function parseData(value: unknown): BenchPayment[] {
  if (!Array.isArray(value)) throw new Error("Bench data must be an array");
  const seen = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== "object" || typeof row.reference !== "string" || !row.reference || seen.has(row.reference)
      || typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)
      || !Number.isFinite(Date.parse(row.date)) || new Date(row.date).toISOString().slice(0, 10) !== row.date
      || typeof row.amount !== "number" || !Number.isFinite(row.amount)
      || typeof row.description !== "string" || !(row.counterparty === null || typeof row.counterparty === "string")
      || typeof row.trueCategory !== "string" || !Object.hasOwn(CATEGORY_MAP, row.trueCategory)
      || !optional(row.source, (v) => v === "bank" || v === "paypal") || !optional(row.currency, text)
      || !optional(row.account, text) || !optional(row.accountIban, textOrNull) || !optional(row.counterpartyIban, textOrNull)) {
      throw new Error("Invalid bench data; values are withheld");
    }
    seen.add(row.reference);
  }
  return value as BenchPayment[];
}
