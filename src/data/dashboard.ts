// Pure version 1 source -> version 2 dashboard. No database or clock access.
export type MonthKey = string;
export interface Month {
  key: MonthKey; label: string; short: string; year: number; month: number; days: number; partial: boolean;
}
export interface Category {
  name: string; icon: string; color: string; kind: "spend" | "income" | "transfer";
}
export interface SourceTxn {
  id: string; date: string; amount: number; categoryName: string; tags: string[]; place: string; city: string;
}
export interface DashboardSource {
  categories: Category[]; months: Month[]; transactions: SourceTxn[];
  balanceByDay: Record<string, number>; openingBalance: number;
}
export interface Txn {
  id: string; date: string; day: number; month: MonthKey; amount: number;
  categoryName: string; tags: string[]; place: string; city: string;
  categoriesIn: string[]; incomeBuckets: string[];
}
export interface Totals {
  expense: number; income: number;
  categories: { name: string; total: number }[];
  incomeBuckets: { name: string; total: number }[];
}
export interface MonthData extends Totals {
  endBalance: number; dayExpense: number[]; dayIncome: number[]; dayBalance: number[];
}
export interface Series { months: number[]; days: Record<MonthKey, number[]> }
export interface Dashboard {
  version: 2; months: Month[]; categories: Category[]; incomeBuckets: Category[]; transactions: Txn[];
  overview: { expense: number[]; income: number[]; balance: number[] };
  total: Totals; byMonth: Record<MonthKey, MonthData>; spend: Record<string, Series>; income: Record<string, Series>;
  pick: { spend: string[]; income: string[] };
}

const money = (n: number) => Math.round(n * 100) / 100;
const INCOME_META: Record<string, Category> = {
  Refunds: { name: "Refunds", icon: "RotateCcw", color: "#34E27A", kind: "income" },
  Other: { name: "Other", icon: "CircleHelp", color: "#9AA6B8", kind: "income" },
};

export function buildDashboard(source: DashboardSource): Dashboard {
  const { months, categories, balanceByDay } = source;
  const catByName = new Map(categories.map((c) => [c.name, c]));
  const incomeKeep = new Set(["Tax", ...categories.filter((c) => c.kind !== "spend").map((c) => c.name)]);
  const monthIndex = new Map(months.map((m, i) => [m.key, i]));
  const makeSeries = (): Series => ({
    months: months.map(() => 0),
    days: Object.fromEntries(months.map((m) => [m.key, new Array<number>(m.days).fill(0)])),
  });
  const spend = new Map(categories.map((c) => [c.name, makeSeries()]));
  const income = new Map<string, Series>();
  const categoryAll = new Map(categories.map((c) => [c.name, 0]));
  const categoryMonths = months.map(() => new Map(categories.map((c) => [c.name, 0])));
  const incomeAll = new Map<string, number>();
  // A separate insertion order per month preserves the legacy income-row tie order.
  const incomeMonths = months.map(() => new Map<string, number>());
  const total: Totals = { expense: 0, income: 0, categories: [], incomeBuckets: [] };
  const byMonth: Record<string, MonthData> = Object.fromEntries(months.map((mo) => {
    const dayBalance = Array.from({ length: mo.days }, (_, i) => balanceByDay[`${mo.key}-${String(i + 1).padStart(2, "0")}`] ?? 0);
    return [mo.key, {
      expense: 0, income: 0, categories: [], incomeBuckets: [],
      endBalance: balanceByDay[`${mo.key}-${String(mo.days).padStart(2, "0")}`],
      dayExpense: new Array<number>(mo.days).fill(0), dayIncome: new Array<number>(mo.days).fill(0), dayBalance,
    }];
  }));
  const add = (map: Map<string, number>, name: string, amount: number) => map.set(name, (map.get(name) || 0) + amount);
  const transactions: Txn[] = [];

  // Every accumulator receives additions in the original transaction order. In
  // particular, all-time totals must not be calculated by summing rounded months.
  for (const t of source.transactions) {
    const month = t.date.slice(0, 7);
    const day = parseInt(t.date.slice(8), 10);
    const index = monthIndex.get(month);
    const mo = index === undefined ? undefined : byMonth[month];
    const validDay = !!mo && day >= 1 && day <= mo.dayExpense.length;
    const tags = t.tags || [];
    const categoriesIn = [...new Set([t.categoryName, ...tags])];
    const primaryBucket = !t.categoryName || t.categoryName === "Uncategorised" ? "Other"
      : incomeKeep.has(t.categoryName) ? t.categoryName : "Refunds";
    const buckets = t.amount > 0 ? [...new Set([primaryBucket, ...tags.filter((n) => incomeKeep.has(n))])] : [];
    transactions.push({
      id: t.id, date: t.date, day, month, amount: t.amount, categoryName: t.categoryName,
      tags: [...tags], place: t.place, city: t.city, categoriesIn, incomeBuckets: buckets,
    });
    if (catByName.get(t.categoryName)?.kind === "spend") {
      total.expense += -t.amount;
      if (mo) { mo.expense += -t.amount; if (validDay) mo.dayExpense[day - 1] += -t.amount; }
    }
    for (const name of categoriesIn) {
      const series = spend.get(name);
      if (!series) continue;
      add(categoryAll, name, -t.amount);
      if (index !== undefined) {
        add(categoryMonths[index], name, -t.amount);
        series.months[index] += -t.amount;
        if (validDay) series.days[month][day - 1] += -t.amount;
      }
    }
    if (t.amount > 0) {
      total.income += t.amount;
      if (mo) { mo.income += t.amount; if (validDay) mo.dayIncome[day - 1] += t.amount; }
      for (const bucket of buckets) {
        if (!income.has(bucket)) income.set(bucket, makeSeries());
        add(incomeAll, bucket, t.amount);
        if (index !== undefined) {
          add(incomeMonths[index], bucket, t.amount);
          const series = income.get(bucket)!;
          series.months[index] += t.amount;
          if (validDay) series.days[month][day - 1] += t.amount;
        }
      }
    }
  }

  const categoryRows = (totals: Map<string, number>) => categories.filter((c) => c.kind === "spend")
    .map((c) => ({ name: c.name, total: money(totals.get(c.name) ?? 0) }))
    .filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  const incomeRows = (totals: Map<string, number>) => [...totals].map(([name, n]) => ({ name, total: money(n) }))
    .sort((a, b) => b.total - a.total);
  total.expense = money(total.expense);
  total.income = money(total.income);
  total.categories = categoryRows(categoryAll);
  total.incomeBuckets = incomeRows(incomeAll);
  months.forEach((m, i) => {
    const mo = byMonth[m.key];
    mo.expense = money(mo.expense); mo.income = money(mo.income);
    mo.dayExpense = mo.dayExpense.map(money); mo.dayIncome = mo.dayIncome.map(money);
    mo.categories = categoryRows(categoryMonths[i]); mo.incomeBuckets = incomeRows(incomeMonths[i]);
  });
  for (const [map, round] of [[spend, (n: number) => money(Math.max(0, n))], [income, money]] as const) {
    for (const series of map.values()) {
      series.months = series.months.map(round);
      for (const m of months) series.days[m.key] = series.days[m.key].map(round);
    }
  }
  // Recategorise choices: money out moves among spend categories, money in among income/transfer
  // categories (+ Tax); each list in the order of its all-time rows, the rest alphabetically.
  const ordered = (names: string[], order: string[]) => names.slice().sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
  const pick = {
    spend: ordered(categories.filter((c) => c.kind === "spend").map((c) => c.name), total.categories.map((r) => r.name)),
    income: ordered(categories.filter((c) => incomeKeep.has(c.name)).map((c) => c.name), total.incomeBuckets.map((r) => r.name)),
  };
  return {
    version: 2, months, categories, pick,
    incomeBuckets: [...income.keys()].map((name) => catByName.get(name) ?? INCOME_META[name]
      ?? { name, icon: "Tag", color: "#34E27A", kind: "income" }),
    transactions, total, byMonth, spend: Object.fromEntries(spend), income: Object.fromEntries(income),
    overview: {
      expense: months.map((m) => byMonth[m.key].expense), income: months.map((m) => byMonth[m.key].income),
      balance: months.map((m) => byMonth[m.key].endBalance),
    },
  };
}
