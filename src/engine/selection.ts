import type { NamedTxn } from "./fixed-costs.js";
export interface SelectablePayment extends NamedTxn {
  categorySource?: string | null
}
export function selectionSummary(transactions: SelectablePayment[], ids: string[], target?: string) {
  const selected = new Set(ids);
  const rows = transactions.filter((p) => selected.has(p.id) && !p.coveredBy);
  if (rows.length !== selected.size || !rows.length
    || new Set(rows.map((p) => Math.sign(p.amount))).size !== 1)
    throw new Error("invalid-selection");
  const shops = new Set(rows.map((p) => p.merchant).filter(Boolean));
  const others = transactions.filter(
    (p) => !selected.has(p.id) && p.merchant && shops.has(p.merchant)
      && Math.sign(p.amount) === Math.sign(rows[0].amount)
      && !["manual", "structural", "receipt"].includes(p.categorySource || "")
      && (p.categoriesIn.length || p.incomeBuckets.length)
      && p.categoryName !== target);
  return {
    ids: rows.map((p) => p.id),
    count: rows.length,
    side: rows[0].amount > 0 ? "income" : "spend",
    total: rows.reduce((n, p) => n + Math.round(Math.abs(p.counted ?? p.amount) * 100), 0) / 100,
    shops: shops.size,
    otherCount: others.length,
    otherIDs: others.map((p) => p.id)
  };
}
