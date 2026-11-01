// Pure version 1 source -> version 2 dashboard. No database or clock access.
export type MonthKey = string;
export interface Month {
  key: MonthKey; label: string; short: string; year: number; month: number; days: number; partial: boolean;
}
export interface Category {
  name: string; icon: string; color: string; kind: "spend" | "income" | "transfer";
  otherSide?: true; // also offered for the other direction of money; totals still follow kind
}
// Receipts (brief 30): every field here is optional, so older readers of the JSON keep working.
export interface ReceiptMarks {
  /** The receipt this row is: a cash receipt, or a card receipt not joined to its bank payment yet. */
  receiptId?: string;
  /** A card receipt waiting for its bank payment ("waiting for the bank statement"). */
  provisional?: boolean;
  /**
   * Cash taken out of this withdrawal by these receipts: a positive amount in the withdrawal's category and month that
   * lowers its spending; never income, also when the withdrawal has no category.
   */
  coveredBy?: string[];
  /** A cash withdrawal, a source of the Cash page (brief 32). Only in the phone's dashboard (when receipts are given). */
  cashWithdrawal?: boolean;
}
// The Cash page (brief 32, D9): every cash movement from the wallet's side. A view: nothing in it counts in the totals
// (each movement counts where it counts: the receipt in its category, the gift in its income category, the
// withdrawal's rest in the withdrawal's category). Only in the phone's dashboard (when receipts are given).
export interface CashView {
  /** Per month ("YYYY-MM") with any cash movement; a month without one is left out. */
  months: Record<MonthKey, CashMonth>;
  /** Every cash movement, by date, the newest last (on one day the money in first). */
  movements: CashMovement[];
}
export interface CashMonth {
  /** Cash taken from the bank: the month's withdrawals. */
  withdrawn: number;
  /** Cash received (gifts, money from selling something). */
  received: number;
  /** Cash spent: receipts and entries by hand. A gift spent on something is here, the gift itself in `received`. */
  spent: number;
  /** What the month's withdrawals still hold after everything that took from them (what their category shows). */
  unaccounted: number;
}
export interface CashMovement {
  /** A withdrawal's payment id, or the receipt's or entry's id. */
  id: string;
  date: string;
  /** From the wallet's side: + cash in (withdrawn, received), − cash out (receipts, entries). */
  amount: number;
  kind: "withdrawal" | "received" | "receipt" | "manual";
  place: string;
  /** Its category as the dashboard names it ("Uncategorised" when it has none). */
  category: string;
  /** Cash out: the sources it took from, in the order it took ([] = all of it from elsewhere). Cash in: null. */
  paidFrom: string[] | null;
  /** Cash in: the receipts and entries that took from it ([] = none yet). Cash out: null. */
  coveredBy: string[] | null;
  /** Cash in: what it still holds after everything that took from it. Cash out: null. */
  left: number | null;
}
export interface SourceTxn extends ReceiptMarks {
  id: string; date: string; amount: number; categoryName: string; tags: string[]; place: string; city: string;
}
export interface DashboardSource {
  categories: Category[]; months: Month[]; transactions: SourceTxn[];
  balanceByDay: Record<string, number>; openingBalance: number;
  databaseCategoryNames: string[]; // recategorise targets; excludes dashboard-only categories
  cash?: CashView; // the Cash page (brief 32); the server's source never has it
}
export interface Txn extends ReceiptMarks {
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
  endBalance: number; dayExpense: number[]; dayExpenseRunning: number[]; dayIncome: number[]; dayBalance: number[];
}
export interface Series { months: number[]; days: Record<MonthKey, number[]> }
export interface Dashboard {
  version: 2; months: Month[]; categories: Category[]; incomeBuckets: Category[]; transactions: Txn[];
  overview: { expense: number[]; income: number[]; balance: number[] };
  total: Totals; byMonth: Record<MonthKey, MonthData>; spend: Record<string, Series>; income: Record<string, Series>;
  pick: { spend: string[]; income: string[] };
  cash?: CashView; // the Cash page (brief 32), passed on from the source; never counted
}

const money = (n: number) => Math.round(n * 100) / 100;
// Payments without a category ("Not sorted" in the apps; engine/source.ts names them so). Their money in counts as
// income ("Other") only, never as negative spending (Patrik, 2026-10-27): a salary from a new employer used to lower
// "Not sorted"'s spending, and a month with more unsorted money in than out showed no "Not sorted" spending at all.
const isUnsorted = (categoryName: string) => !categoryName || categoryName === "Uncategorised";
const INCOME_META: Record<string, Category> = {
  Refunds: { name: "Refunds", icon: "RotateCcw", color: "#34E27A", kind: "income" },
  Other: { name: "Other", icon: "CircleHelp", color: "#9AA6B8", kind: "income" },
};

export function buildDashboard(source: DashboardSource): Dashboard {
  const { months, categories, balanceByDay } = source;
  const catByName = new Map(categories.map((c) => [c.name, c]));
  // Recategorise choices for money in: income and transfer categories (and Tax).
  const incomeKeep = new Set(["Tax", ...categories.filter((c) => c.kind !== "spend").map((c) => c.name)]);
  // Income rows: income categories (and Tax). Transfer categories count nowhere, on either side (Patrik, 2026-10-27:
  // money moved between one's own accounts is not income).
  const incomeBucketKeep = new Set(["Tax", ...categories.filter((c) => c.kind === "income").map((c) => c.name)]);
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
      dayExpense: new Array<number>(mo.days).fill(0), dayExpenseRunning: [], dayIncome: new Array<number>(mo.days).fill(0), dayBalance,
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
    // Cash covered by receipts lowers its withdrawal's spending; it is never income.
    const covered = t.coveredBy !== undefined;
    // Unsorted money in is listed under "Other" income only: not under "Not sorted", not in its spending.
    const unsortedIn = t.amount > 0 && isUnsorted(t.categoryName) && !covered;
    const categoriesIn = [...new Set([t.categoryName, ...tags])].filter((name) => !(unsortedIn && isUnsorted(name)));
    const primaryKind = catByName.get(t.categoryName)?.kind;
    const isTransfer = primaryKind === "transfer";
    const incomeOut = t.amount < 0 && primaryKind === "income" && !isUnsorted(t.categoryName);
    const primaryBucket = isUnsorted(t.categoryName) ? "Other"
      : incomeBucketKeep.has(t.categoryName) ? t.categoryName : "Refunds";
    // Money given back reduces income only in income categories (Tax keeps its spending rules).
    const buckets = isTransfer || covered ? [] : t.amount > 0
      ? [...new Set([primaryBucket, ...tags.filter((n) => incomeBucketKeep.has(n))])]
      : t.amount < 0 ? [...new Set([
        ...(incomeOut ? [t.categoryName] : []),
        ...tags.filter((n) => catByName.get(n)?.kind === "income" && !isUnsorted(n)),
      ])] : [];
    const txn: Txn = {
      id: t.id, date: t.date, day, month, amount: t.amount, categoryName: t.categoryName,
      tags: [...tags], place: t.place, city: t.city, categoriesIn, incomeBuckets: buckets,
    };
    if (t.receiptId !== undefined) txn.receiptId = t.receiptId;
    if (t.provisional) txn.provisional = true;
    if (covered) txn.coveredBy = [...t.coveredBy!];
    if (t.cashWithdrawal) txn.cashWithdrawal = true;
    transactions.push(txn);
    if (catByName.get(t.categoryName)?.kind === "spend" && !unsortedIn) {
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
    if ((t.amount > 0 || incomeOut) && !isTransfer && !covered) {
      total.income += t.amount;
      if (mo) { mo.income += t.amount; if (validDay) mo.dayIncome[day - 1] += t.amount; }
    }
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

  const categoryRows = (totals: Map<string, number>) => categories.filter((c) => c.kind === "spend")
    .map((c) => ({ name: c.name, total: money(totals.get(c.name) ?? 0) }))
    .filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  const incomeRows = (totals: Map<string, number>) => [...totals].map(([name, n]) => ({ name, total: money(n) }))
    .filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  total.expense = money(total.expense);
  total.income = money(total.income);
  total.categories = categoryRows(categoryAll);
  total.incomeBuckets = incomeRows(incomeAll);
  months.forEach((m, i) => {
    const mo = byMonth[m.key];
    mo.expense = money(mo.expense); mo.income = money(mo.income);
    // Running total of money out through the month, summed before rounding (the widget's line).
    let running = 0;
    mo.dayExpenseRunning = mo.dayExpense.map((v) => money(running += v));
    mo.dayExpense = mo.dayExpense.map(money); mo.dayIncome = mo.dayIncome.map(money);
    mo.categories = categoryRows(categoryMonths[i]); mo.incomeBuckets = incomeRows(incomeMonths[i]);
  });
  const roundSeries = (n: number) => money(Math.max(0, n));
  for (const map of [spend, income]) {
    for (const series of map.values()) {
      series.months = series.months.map(roundSeries);
      for (const m of months) series.days[m.key] = series.days[m.key].map(roundSeries);
    }
  }
  // Home-side choices first, then transfers; money in also keeps Tax. Categories offered on the other side come
  // last, in their own side's row order. Within each part, categories without rows follow alphabetically.
  const ordered = (names: string[], order: string[]) => names.slice().sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
  const databaseNames = new Set(source.databaseCategoryNames);
  // Database categories precede any synthesised names in the source. Keep each real choice once.
  const choices = categories.filter((c, i) => databaseNames.has(c.name)
    && categories.findIndex((other) => other.name === c.name) === i);
  const spendOrder = total.categories.map((r) => r.name);
  const incomeOrder = total.incomeBuckets.map((r) => r.name);
  const pick = {
    spend: [
      ...ordered(choices.filter((c) => c.kind === "spend").map((c) => c.name), spendOrder),
      ...ordered(choices.filter((c) => c.kind === "transfer").map((c) => c.name), incomeOrder),
      ...ordered(choices.filter((c) => c.kind === "income" && c.otherSide).map((c) => c.name), incomeOrder),
    ],
    income: [
      ...ordered(choices.filter((c) => incomeKeep.has(c.name)).map((c) => c.name), incomeOrder),
      ...ordered(choices.filter((c) => c.kind === "spend" && c.otherSide && !incomeKeep.has(c.name)).map((c) => c.name), spendOrder),
    ],
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
    ...(source.cash ? { cash: source.cash } : {}),
  };
}
