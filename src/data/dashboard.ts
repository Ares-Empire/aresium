// Pure version 1 source -> version 2 dashboard. No database or clock access.
export type MonthKey = string;
export interface Month {
  key: MonthKey; label: string; short: string; year: number; month: number; days: number; partial: boolean;
}
export interface Category {
  name: string; icon: string; color: string; kind: "spend" | "income" | "transfer";
  otherSide?: true; // also offered for the other direction of money; totals follow the payment's direction
}
export interface PaymentLink { payment: string; amount: number }
/** Applied links only; absent on payments whose counting is unchanged. All amounts are euros. */
export interface PaybackMarks {
  counted?: number;
  paidBack?: number;
  paidBackBy?: PaymentLink[];
  paysBack?: PaymentLink[];
}
export interface PaybackIgnored {
  from: string; to: string;
  reason: "payer-not-counted" | "payer-not-money-in" | "payer-transfer" | "payer-not-euros"
    | "target-missing" | "target-not-counted" | "target-not-money-out" | "target-transfer"
    | "target-withdrawal" | "target-not-euros" | "invalid-amount" | "clamped";
  /** For clamped links, the euros that did not count. */
  amount?: number;
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
  /** A cash withdrawal, a source of the Cash page. Present when receipts or manual cash entries are given. */
  cashWithdrawal?: boolean;
}
// The Cash page (brief 32, D9): every cash movement from the wallet's side. A view: nothing in it counts in the totals
// (each movement counts where it counts: the receipt in its category, the gift in its income category, the
// withdrawal's rest in the withdrawal's category). Present when receipts or manual cash entries are given.
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
export interface SourceTxn extends ReceiptMarks, PaybackMarks {
  id: string; date: string; amount: number; categoryName: string; tags: string[]; place: string; city: string;
}
export interface BalanceUncertainDay {
  date: string;
  accountId: string | null;
}
export interface DashboardSource {
  categories: Category[]; months: Month[]; transactions: SourceTxn[];
  balanceByDay: Record<string, number | null>; openingBalance: number | null;
  databaseCategoryNames: string[]; // recategorise targets; excludes dashboard-only categories
  cash?: CashView; // the Cash page (brief 32); present when receipts or manual cash inputs are supplied
  paybacksIgnored?: PaybackIgnored[];
  balanceUncertainDays?: BalanceUncertainDay[];
}
export interface Txn extends ReceiptMarks, PaybackMarks {
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
  endBalance: number | null; dayExpense: number[]; dayExpenseRunning: number[]; dayIncome: number[];
  dayBalance: (number | null)[];
}
export interface Series { months: number[]; days: Record<MonthKey, number[]> }
export interface Dashboard {
  version: 2; months: Month[]; categories: Category[]; incomeBuckets: Category[]; transactions: Txn[];
  overview: { expense: number[]; income: number[]; balance: (number | null)[] };
  total: Totals; byMonth: Record<MonthKey, MonthData>; spend: Record<string, Series>; income: Record<string, Series>;
  pick: { spend: string[]; income: string[] };
  cash?: CashView; // the Cash page (brief 32), passed on from the source; never counted
  paybacksIgnored?: PaybackIgnored[];
  balanceUncertainDays?: BalanceUncertainDay[];
}

const money = (n: number) => Math.round(n * 100) / 100;
// Payments without a category ("Not sorted" in the apps; engine/source.ts names them so). Their money in counts as
// income only, never as negative spending (Patrik, 2026-10-27), under the same "Uncategorised" on the income side as
// their money out on the spending side (2026-11-01: the income side's old name "Other" showed untranslated in the
// app and shared its row with the default category called "Other" in English).
const UNSORTED = "Uncategorised";
const isUnsorted = (categoryName: string) => !categoryName || categoryName === UNSORTED;
const UNSORTED_META: Category = { name: UNSORTED, icon: "CircleHelp", color: "#9ca3af", kind: "spend" };

export function buildDashboard(source: DashboardSource): Dashboard {
  const { months, categories, balanceByDay } = source;
  const catByName = new Map(categories.map((c) => [c.name, c]));
  // Recategorise choices for money in: income and transfer categories (and Tax).
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
    const dayBalance = Array.from({ length: mo.days }, (_, i) => balanceByDay[`${mo.key}-${String(i + 1).padStart(2, "0")}`] ?? null);
    return [mo.key, {
      expense: 0, income: 0, categories: [], incomeBuckets: [],
      endBalance: balanceByDay[`${mo.key}-${String(mo.days).padStart(2, "0")}`] ?? null,
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
    const isTransfer = catByName.get(t.categoryName)?.kind === "transfer";
    const names = [...new Set([t.categoryName, ...tags])]
      .filter((name) => catByName.get(name)?.kind !== "transfer");
    // Sides decide the choices only. Each payment counts in the direction it went, including its tags.
    const spending = !isTransfer && (t.amount < 0 || covered);
    const incoming = !isTransfer && t.amount > 0 && !covered;
    const amount = t.counted ?? t.amount;
    const categoriesIn = spending ? names : [];
    const buckets = incoming ? [...new Set(names.map((name) => isUnsorted(name) ? UNSORTED : name))] : [];
    const txn: Txn = {
      id: t.id, date: t.date, day, month, amount: t.amount, categoryName: t.categoryName,
      tags: [...tags], place: t.place, city: t.city, categoriesIn, incomeBuckets: buckets,
    };
    if (t.receiptId !== undefined) txn.receiptId = t.receiptId;
    if (t.provisional) txn.provisional = true;
    if (covered) txn.coveredBy = [...t.coveredBy!];
    if (t.cashWithdrawal) txn.cashWithdrawal = true;
    if (t.counted !== undefined && t.counted !== t.amount) txn.counted = t.counted;
    if (t.paidBack !== undefined) txn.paidBack = t.paidBack;
    if (t.paidBackBy) txn.paidBackBy = t.paidBackBy.map((link) => ({ ...link }));
    if (t.paysBack) txn.paysBack = t.paysBack.map((link) => ({ ...link }));
    transactions.push(txn);
    if (spending) {
      total.expense += -amount;
      if (mo) { mo.expense += -amount; if (validDay) mo.dayExpense[day - 1] += -amount; }
    }
    for (const name of categoriesIn) {
      const series = spend.get(name);
      if (!series) continue;
      add(categoryAll, name, -amount);
      if (index !== undefined) {
        add(categoryMonths[index], name, -amount);
        series.months[index] += -amount;
        if (validDay) series.days[month][day - 1] += -amount;
      }
    }
    if (incoming) {
      total.income += amount;
      if (mo) { mo.income += amount; if (validDay) mo.dayIncome[day - 1] += amount; }
    }
    for (const bucket of buckets) {
      if (!income.has(bucket)) income.set(bucket, makeSeries());
      add(incomeAll, bucket, amount);
      if (index !== undefined) {
        add(incomeMonths[index], bucket, amount);
        const series = income.get(bucket)!;
        series.months[index] += amount;
        if (validDay) series.days[month][day - 1] += amount;
      }
    }
  }

  const categoryRows = (totals: Map<string, number>) => categories.filter((c) => c.kind !== "transfer")
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
    incomeBuckets: [...income.keys()].map((name) => catByName.get(name) ?? (name === UNSORTED ? UNSORTED_META : undefined)
      ?? { name, icon: "Tag", color: "#34E27A", kind: "income" }),
    transactions, total, byMonth, spend: Object.fromEntries(spend), income: Object.fromEntries(income),
    overview: {
      expense: months.map((m) => byMonth[m.key].expense), income: months.map((m) => byMonth[m.key].income),
      balance: months.map((m) => byMonth[m.key].endBalance),
    },
    ...(source.balanceUncertainDays?.length
      ? { balanceUncertainDays: source.balanceUncertainDays.map((day) => ({ ...day })) } : {}),
    ...(source.cash ? { cash: source.cash } : {}),
    ...(source.paybacksIgnored?.length ? { paybacksIgnored: source.paybacksIgnored.map((link) => ({ ...link })) } : {}),
  };
}
