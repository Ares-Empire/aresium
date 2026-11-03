import type { NamedTxn } from "./fixed-costs.js";
export function quickSortGroups(transactions: NamedTxn[], descriptions: Record<string, string> = {}) {
  const groups = new Map<string, NamedTxn[]>();
  for (const p of transactions) {
    if (p.categoryName !== "Uncategorised" || !p.nameKey || p.coveredBy
      || !(p.categoriesIn.length || p.incomeBuckets.length))
      continue;
    const key = p.nameKey + "\u001f" + (p.amount > 0 ? "income" : "spend");
    const group = groups.get(key) ?? [];
    group.push(p);
    groups.set(key, group);
  }
  return [...groups].map(
    ([key, rows]) => {
      rows = rows.slice().sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      return {
        key,
        name: rows.at(-1)!.place,
        ids: rows.map((p) => p.id),
        count: rows.length,
        side: rows[0].amount > 0 ? "income" : "spend",
        total: rows.reduce((n, p) => n + Math.round(Math.abs(p.counted ?? p.amount) * 100), 0) / 100,
        first: rows[0].date,
        last: rows.at(-1)!.date,
        examples: [...new Set(rows.map((p) => descriptions[p.id] || p.bankName || p.place))].slice(0, 3)
      };
    }).sort((a, b) => b.count - a.count || b.total - a.total || a.key.localeCompare(b.key));
}
