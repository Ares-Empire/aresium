// Port of the app's FixedCosts.swift (briefs 208, 216 and 217). Integer cents and UTC days throughout.
import type { Category, Dashboard, Txn } from "../data/dashboard.js";
export type LedgerSide = "expenses" | "income";
export type Cadence = "monthly" | "quarterly" | "halfYearly" | "yearly";
export interface FixedCostMark {
  key: string;
  side: LedgerSide;
  cadence: Cadence;
  anchor: string
}
export interface NamedTxn extends Txn {
  nameKey?: string;
  fixedCostKey?: string;
  ledgerSequence?: number;
  bankName?: string;
  merchant?: string
}
export interface FixedCostEntry {
  id: string;
  mark: FixedCostMark;
  newest: NamedTxn;
  category: Category;
  name: string;
  side: LedgerSide;
  cadence: Cadence;
  cents: number;
  monthlyCents: number;
  amount: number;
  monthlyEquivalent: number;
  count: number;
  first: string;
  last: string;
  nextDue: string;
  running: boolean;
  notFixed: boolean;
  exclusionIDs: string[];
  ids: string[];
}
export interface FixedCostList {
  running: FixedCostEntry[];
  ended: FixedCostEntry[];
  takenOut: FixedCostEntry[];
  monthlyCents: number;
  monthlyTotal: number;
  yearlyTotal: number
}
export const CADENCES: Record<Cadence, {
  months: number;
  min: number;
  max: number;
  grace: number
}> = {
  monthly: {
    months: 1,
    min: 26,
    max: 35,
    grace: 45
  },
  quarterly: {
    months: 3,
    min: 85,
    max: 98,
    grace: 120
  },
  halfYearly: {
    months: 6,
    min: 175,
    max: 190,
    grace: 220
  },
  yearly: {
    months: 12,
    min: 355,
    max: 375,
    grace: 400
  },
};
export const markID = (mark: FixedCostMark) => [mark.key, mark.side, mark.cadence, mark.anchor].join("\u001f");
const date = (day: string) => {
  const time = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(day + "T12:00:00Z") : NaN;
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? time : NaN;
};
export function nextFixedDay(day: string, cadence: Cadence): string {
  const d = new Date(date(day));
  const month = d.getUTCMonth() + CADENCES[cadence].months;
  const start = new Date(Date.UTC(d.getUTCFullYear(), month, 1, 12));
  const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(d.getUTCDate(), last));
  return start.toISOString().slice(0, 10);
}
interface Payment {
  row: NamedTxn;
  cents: number;
  order: number;
  date: number
}
interface Series {
  payments: Payment[];
  anchors: Payment[];
  cadence?: Cadence
}
const gap = (a: number, b: number) => (b - a) / 86400000;
const distance = (a: number, b: number) => Math.min(Math.abs(a - b), 31 - Math.abs(a - b));
const chronological = (a: Payment, b: Payment) => a.date - b.date || a.order - b.order;
function usualDay(dates: number[]) {
  const days = dates.map((d) => new Date(d).getUTCDate());
  return Array.from(
    {
      length: 31
    },
    (_, i) => {
      const distances = days.map((d) => distance(d, i + 1));
      return {
        day: i + 1,
        total: distances.reduce((a, b) => a + b, 0),
        close: distances.filter((d) => d <= 5).length
      };
    }).sort((a, b) => a.total - b.total || b.close - a.close || a.day - b.day)[0];
}
const steady = (dates: number[]) => usualDay(dates).close * 4 >= dates.length * 3;
function cadenceFor(dates: number[], short = false): Cadence | undefined {
  if (dates.length < 2)
    return;
  const gaps = dates.slice(1).map((d, i) => gap(dates[i], d));
  return (Object.keys(CADENCES) as Cadence[]).find(
    (key) => {
      const c = CADENCES[key];
      const within = (n: number) => n >= c.min && n <= c.max;
      const twice = (n: number) => n >= c.min * 2 && n <= c.max * 2;
      if (!short && dates.length < (c.months < 6 ? 3 : 2))
        return false;
      const normalized = gaps.map((n) => twice(n) ? n / 2 : n).sort((a, b) => a - b);
      const middle = Math.floor(normalized.length / 2);
      const median = normalized.length % 2 ? normalized[middle] : (normalized[middle - 1] + normalized[middle]) / 2;
      return gaps.some(within) && within(median) && gaps.every((n) => n >= median / 2)
        && gaps.filter((n) => within(n) || twice(n)).length * 4 >= gaps.length * 3
        && (c.months >= 6 || steady(dates));
    });
}
function period(time: number, usual: number): number {
  const d = new Date(time);
  const nearest = [-1, 0, 1].map(
    (offset) => {
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
      const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
      start.setUTCDate(Math.min(usual, last));
      return start;
    }).sort((a, b) => Math.abs(a.getTime() - time) - Math.abs(b.getTime() - time))[0];
  return nearest.getUTCFullYear() * 12 + nearest.getUTCMonth();
}
function amountSeries(payments: Payment[]): Payment[][] {
  const result: Payment[][] = [];
  for (const payment of payments) {
    const choices = result.map((s, i) => ({
      i,
      delta: Math.abs(s.at(-1)!.cents - payment.cents)
    }))
      .filter((s) => s.delta <= Math.max(300, Math.round(payment.cents * 0.1)))
      .sort((a, b) => a.delta - b.delta || a.i - b.i);
    if (choices.length)
      result[choices[0].i].push(payment); else
      result.push([payment]);
  }
  return result;
}
function mergePriceSteps(amounts: Payment[][]): Payment[][] {
  const result = amounts.slice().sort((a, b) => chronological(a[0], b[0]));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < result.length; i++) {
      const previous = result[i];
      const dates = previous.map((p) => p.date);
      const cadence = cadenceFor(dates, true);
      if (!cadence || !steady(dates))
        continue;
      const usual = usualDay(dates).day;
      const j = result.findIndex(
        (next, j) => j !== i && previous.at(-1)!.date < next[0].date
          && cadenceFor(next.map((p) => p.date), true) === cadence
          && steady(next.map((p) => p.date))
          && distance(usualDay(next.map((p) => p.date)).day, usual) <= 5
          && period(next[0].date, usual) - period(previous.at(-1)!.date, usual) === CADENCES[cadence].months
          && cadenceFor([...dates, ...next.map((p) => p.date)]) === cadence);
      if (j < 0)
        continue;
      result[i] = previous.concat(result[j]);
      result.splice(j, 1);
      changed = true;
      break;
    }
  }
  return result;
}
function splitCombined(payments: Payment[]): Series[] {
  let remaining = payments;
  const result: Series[] = [];
  while (true) {
    const seeds = mergePriceSteps(amountSeries(remaining)).sort((a, b) => a.at(-1)!.cents - b.at(-1)!.cents);
    const regular: Series[] = seeds.flatMap(
      (seed) => {
        const cadence = cadenceFor(seed.map((p) => p.date));
        return cadence
          ? [{
            payments: seed,
            anchors: seed,
            cadence
          }]
          : [];
      });
    let found: Series | undefined;
    for (const seed of seeds) {
      if (seed.length < 2)
        continue;
      const dates = seed.map((p) => p.date);
      const original = cadenceFor(dates);
      if (!steady(dates) || (original && CADENCES[original].months >= 6))
        continue;
      const gaps = dates.slice(1).map((d, i) => gap(dates[i], d));
      const ownIDs = new Set(seed.map((p) => p.row.id));
      const usual = usualDay(dates).day;
      const phase = period(dates[0], usual);
      for (const cadence of ["monthly", "quarterly"] as const) {
        const c = CADENCES[cadence];
        if ((original && original !== cadence)
          || !gaps.some((n) => (n >= c.min && n <= c.max) || (n >= c.min * 2 && n <= c.max * 2)))
          continue;
        const ownSlots = new Set(dates.map((d) => period(d, usual)));
        const carriedCents = (p: Payment) => seed.filter((s) => s.row.date <= p.row.date).at(-1)?.cents
          ?? seed[0].cents;
        const canCarry = (p: Payment) => (period(p.date, usual) - phase) % c.months === 0
          && !ownSlots.has(
            period(p.date, usual))
          && distance(new Date(p.date).getUTCDate(), usual) <= 5
          && p.cents > carriedCents(p);
        const reserved = new Set(regular.flatMap((s) => s.payments.map((p) => p.row.id)));
        const occupied = new Set(ownSlots);
        const augmented = seed.slice();
        for (const owner of regular) {
          if (CADENCES[owner.cadence!].months < 6 || CADENCES[owner.cadence!].months <= c.months
            || !owner.payments.every((p) => canCarry(p) && !occupied.has(period(p.date, usual))))
            continue;
          const extras = owner.payments.map((p) => ({
            ...p,
            cents: p.cents - carriedCents(p)
          }));
          if (mergePriceSteps(amountSeries(extras)).some(
            (s) => s.length === extras.length && cadenceFor(s
              .map((p) => p.date)) === owner.cadence)) {
            for (const p of owner.payments) {
              occupied.add(period(p.date, usual));
              augmented.push({
                ...p,
                cents: carriedCents(p)
              });
            }
          }
        }
        for (const p of remaining) {
          const slot = period(p.date, usual);
          if (ownIDs.has(p.row.id) || reserved.has(p.row.id) || !canCarry(p) || occupied.has(slot))
            continue;
          occupied.add(slot);
          augmented.push({
            ...p,
            cents: carriedCents(p)
          });
        }
        augmented.sort(chronological);
        if (cadenceFor(augmented.map((p) => p.date)) !== cadence)
          continue;
        found = {
          payments: augmented,
          anchors: seed,
          cadence
        };
        break;
      }
      if (found)
        break;
    }
    if (!found)
      break;
    result.push(found);
    const allocated = new Map(found.payments.map((p) => [p.row.id, p.cents]));
    remaining = remaining.map((p) => ({
      ...p,
      cents: p.cents - (allocated.get(p.row.id) ?? 0)
    })).filter((p) => p.cents > 0);
  }
  return result.concat(
    mergePriceSteps(amountSeries(remaining)).map(
      (p) => ({
        payments: p,
        anchors: p,
        cadence: cadenceFor(p.map((p) => p.date))
      })));
}
export function fixedCostEntries(
  dashboard: Omit<Dashboard, "transactions"> & {
    transactions: NamedTxn[]
  },
  marks: FixedCostMark[] = []): FixedCostEntry[] {
  const bank = dashboard.transactions.filter((t) => t.receiptId === undefined && t.coveredBy === undefined);
  const reference = bank.map((p) => p.date).sort().at(-1);
  if (!reference)
    return [];
  const categories = new Map([...dashboard.categories, ...dashboard.incomeBuckets].map((c) => [c.name, c]));
  const groups = new Map<string, Payment[]>();
  bank.map((row, order) => ({
    row,
    order
  })).filter(
    ({ row }) => row.nameKey && !row.cashWithdrawal && (row.counted ?? row.amount) !== 0
      && categories.get(row.categoryName)?.kind !== "transfer"
      && (row.categoriesIn.length || row.incomeBuckets.length)
      && Number.isFinite(date(row.date)))
    .sort((a, b) => a.row.date.localeCompare(b.row.date) || a.order - b.order).forEach(
      ({ row, order }) => {
        const key = row.nameKey + "\u001f" + (row.amount < 0 ? "expenses" : "income");
        const group = groups.get(key) ?? [];
        group.push(
          {
            row,
            order,
            cents: Math.round(Math.abs(row.counted ?? row.amount) * 100),
            date: date(row.date)
          });
        groups.set(key, group);
      });
  return [...groups.keys()].sort().flatMap(
    (key) => {
      const series = splitCombined(groups.get(key)!);
      return series.flatMap(
        (s): FixedCostEntry[] => {
          const { cadence, payments, anchors } = s;
          if (!cadence)
            return [];
          const newest = payments.at(-1)!.row;
          const first = payments[0].row.date;
          if (CADENCES[cadence].months >= 6
            && series.some(
              (other) => !other.cadence
                && other.payments.some((p) => p.row.date >= first && p.row.date
                  <= newest.date)))
            return [];
          const side = newest.amount < 0 ? "expenses" : "income";
          const names = side === "expenses" ? newest.categoriesIn : newest.incomeBuckets;
          const category = categories.get(names.includes(newest.categoryName) ? newest.categoryName : names[0]);
          if (!category)
            return [];
          const stored = marks.filter(
            (m) => m.side === side && m.cadence === cadence && anchors.some((p) => p.row.id === m.anchor));
          const anchor = anchors.slice().sort(
            (a, b) => (a.row.ledgerSequence ?? Number.MAX_SAFE_INTEGER)
              - (b.row.ledgerSequence ?? Number.MAX_SAFE_INTEGER))[0].row;
          const mark = stored[0]
            ?? {
            key: anchor.fixedCostKey ?? anchor.nameKey!,
            side,
            cadence,
            anchor: anchor.id
          };
          const cents = payments.at(-1)!.cents;
          const monthlyCents = Math.round(cents / CADENCES[cadence].months);
          return [
            {
              id: markID(mark),
              mark,
              newest,
              category,
              name: newest.place,
              side,
              cadence,
              cents,
              monthlyCents,
              amount: cents / 100,
              monthlyEquivalent: monthlyCents / 100,
              count: payments.length,
              first,
              last: newest.date,
              nextDue: nextFixedDay(newest.date, cadence),
              running: gap(date(newest.date), date(reference)) <= CADENCES[cadence].grace,
              notFixed: !!stored.length,
              exclusionIDs: stored.map(markID),
              ids: payments.slice().reverse().map((p) => p.row.id)
            }
          ];
        });
    });
}
export function fixedCostList(entries: FixedCostEntry[], side: LedgerSide): FixedCostList {
  const rows = entries.filter((e) => e.side === side);
  const ranked = (a: FixedCostEntry, b: FixedCostEntry) =>
    b.monthlyCents - a.monthlyCents || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const running = rows.filter((e) => e.running && !e.notFixed).sort(ranked);
  const monthlyCents = running.reduce((n, e) => n + e.monthlyCents, 0);
  return {
    running,
    ended: rows.filter((e) => !e.running && !e.notFixed)
      .sort((a, b) => b.last.localeCompare(a.last) || a.id.localeCompare(b.id)),
    takenOut: rows.filter((e) => e.notFixed).sort(ranked),
    monthlyCents,
    monthlyTotal: monthlyCents / 100,
    yearlyTotal: monthlyCents * 12 / 100
  };
}
export function monthlyAverage(dashboard: Dashboard, side: LedgerSide) {
  const earliest = dashboard.transactions.map((t) => t.date).sort()[0];
  const late = Number(earliest?.slice(8)) > 7;
  const months = dashboard.months.filter((m) => !m.partial && !(late && m.key === earliest.slice(0, 7)))
    .sort((a, b) => a.key.localeCompare(b.key));
  if (months.length < 2)
    return null;
  const cents = Math.round(
    months.reduce(
      (n, m) => n
        + Math.round((dashboard.byMonth[m.key]?.[side === "expenses" ? "expense" : "income"] ?? 0) * 100),
      0)
    / months.length);
  return {
    cents,
    amount: cents / 100,
    count: months.length,
    first: months[0].key,
    last: months.at(-1)!.key
  };
}
