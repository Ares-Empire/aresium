// One-off (2026-10-27, brief 20): what "Not sorted counts only money out" changes on the real data. Read-only, and it
// prints totals only: no payment, name or text. Run on the server, in the aresium folder:
//
//   npx tsx scripts/oneoff-2026-10-27-unsorted-in.ts
//
// The dashboard now leaves unsorted money in out of spending (src/data/dashboard.ts); before, each such payment
// lowered "Not sorted" and the spending total by its amount. So the old numbers are the new ones minus that money in,
// and this needs no copy of the old code. Delete the script once the numbers are noted.
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { buildDashboard, type Dashboard, type DashboardSource } from "../src/data/dashboard.js";

const money = (n: number) => Math.round(n * 100) / 100;
const UNSORTED = "Uncategorised";

export type MonthEffect = {
  month: string;
  unsortedIn: number; // the month's unsorted money in, now left out of spending
  spendingBefore: number;
  spendingNow: number;
  notSortedBefore: number; // "Not sorted"'s spending; 0 or less hid the month from its list
  notSortedNow: number;
};
export type UnsortedInEffect = {
  payments: number;
  amount: number;
  spendingBefore: number;
  spendingNow: number;
  notSortedBefore: number;
  notSortedNow: number;
  monthsListedBefore: number; // months "Not sorted" showed with spending (> 0)
  monthsListedNow: number;
  changed: MonthEffect[]; // only the months whose numbers change
};

export function unsortedInEffect(source: DashboardSource, dashboard: Dashboard): UnsortedInEffect {
  const unsortedIn = source.transactions.filter((t) => t.amount > 0 && (!t.categoryName || t.categoryName === UNSORTED));
  const inByMonth = new Map<string, number>();
  for (const t of unsortedIn) inByMonth.set(t.date.slice(0, 7), (inByMonth.get(t.date.slice(0, 7)) ?? 0) + t.amount);
  const amount = unsortedIn.reduce((sum, t) => sum + t.amount, 0);
  const series = dashboard.spend[UNSORTED]?.months ?? dashboard.months.map(() => 0);
  const months: MonthEffect[] = dashboard.months.map((m, i) => {
    const unsorted = inByMonth.get(m.key) ?? 0;
    const spendingNow = dashboard.byMonth[m.key].expense;
    return {
      month: m.key,
      unsortedIn: money(unsorted),
      spendingBefore: money(spendingNow - unsorted),
      spendingNow,
      notSortedBefore: money(series[i] - unsorted),
      notSortedNow: series[i],
    };
  });
  const notSortedNow = dashboard.total.categories.find((c) => c.name === UNSORTED)?.total ?? 0;
  return {
    payments: unsortedIn.length,
    amount: money(amount),
    spendingBefore: money(dashboard.total.expense - amount),
    spendingNow: dashboard.total.expense,
    notSortedBefore: money(notSortedNow - amount),
    notSortedNow,
    monthsListedBefore: months.filter((m) => m.notSortedBefore > 0).length,
    monthsListedNow: months.filter((m) => m.notSortedNow > 0).length,
    changed: months.filter((m) => m.unsortedIn !== 0),
  };
}

async function main() {
  const { getDashboardSource } = await import("../src/data/queries.js");
  const { prisma } = await import("../src/lib/db.js");
  try {
    const source = await getDashboardSource();
    const effect = unsortedInEffect(source, buildDashboard(source));
    const eur = (n: number) => `${n.toFixed(2)} EUR`;
    console.log(`Unsorted money in: ${effect.payments} payments, ${eur(effect.amount)}, in ${effect.changed.length} of ${source.months.length} months`);
    console.log(`Spending, all time: before ${eur(effect.spendingBefore)}, now ${eur(effect.spendingNow)}`);
    console.log(`Not sorted, all time: before ${eur(effect.notSortedBefore)}, now ${eur(effect.notSortedNow)}`);
    console.log(`Months with Not sorted spending: before ${effect.monthsListedBefore}, now ${effect.monthsListedNow}`);
    if (effect.changed.length) console.log("\nmonth     unsorted in   spending before → now      Not sorted before → now");
    for (const m of effect.changed) {
      console.log(`${m.month}  ${m.unsortedIn.toFixed(2).padStart(11)}   ${m.spendingBefore.toFixed(2).padStart(10)} → ${m.spendingNow.toFixed(2).padEnd(10)}`
        + `  ${m.notSortedBefore.toFixed(2).padStart(10)} → ${m.notSortedNow.toFixed(2)}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
