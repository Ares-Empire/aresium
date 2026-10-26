import categoryMap from "./category-map.json" with { type: "json" };
export const CATEGORY_MAP: Readonly<Record<string, readonly string[] | null>> = categoryMap;
export type BenchPayment = {
  reference: string; date: string; amount: number; description: string; counterparty: string | null; trueCategory: string;
};
export const DATA_FILE = new URL("out/data.json", import.meta.url);
export const RESULTS_FILE = new URL("out/results.md", import.meta.url);

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
      || typeof row.trueCategory !== "string" || !Object.hasOwn(CATEGORY_MAP, row.trueCategory)) {
      throw new Error("Invalid bench data; values are withheld");
    }
    seen.add(row.reference);
  }
  return value as BenchPayment[];
}
