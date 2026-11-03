import type { PaymentLink } from "../data/dashboard.js";
import type { NamedTxn } from "./fixed-costs.js";
export interface PaybackPayment extends NamedTxn {
  paybackEligible?: boolean
}
export interface PaybackDashboard {
  transactions: PaybackPayment[]
}
export interface PlanLink {
  from: string;
  to: string;
  amount: number;
  totalAmount: number
}
export const centAmount = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n)
  && Number.isSafeInteger(Math.round(n * 100))
  && Math.abs(n * 100 - Math.round(n * 100)) < 1e-7;
const cents = (n: number) => Math.round(n * 100);
export const remaining = (p: PaybackPayment) => Math.min(
  cents(Math.abs(p.amount)),
  cents(Math.abs(p.counted ?? p.amount)),
);
const compare = (a: PaybackPayment, b: PaybackPayment) =>
  a.date.localeCompare(b.date)
  || (a.ledgerSequence ?? 0) - (b.ledgerSequence ?? 0)
  || a.id.localeCompare(b.id);

export function paybackChoices(dashboard: PaybackDashboard, ids: string[]) {
  const wanted = new Set(ids);
  const selected = dashboard.transactions.filter((p) => wanted.has(p.id));
  if (!ids.length || wanted.size !== ids.length || selected.length !== ids.length
    || new Set(selected.map((p) => Math.sign(p.amount))).size !== 1)
    throw new Error("invalid-payment");
  const group = selected.filter((p) => p.paybackEligible && remaining(p) > 0).sort(compare);
  if (!group.length)
    throw new Error("invalid-payment");
  const incoming = group[0].amount > 0;
  const total = group.reduce((n, p) => n + remaining(p), 0);
  const first = Date.parse(group[0].date);
  const last = Date.parse(group.at(-1)!.date);
  const candidates = dashboard.transactions
    .filter((p) => p.paybackEligible && remaining(p) > 0 && (p.amount > 0) !== incoming)
    .sort((a, b) => -compare(a, b));
  const suggestions = candidates.flatMap(
    (candidate) => {
      const days = (Date.parse(candidate.date) - last) / 86400000;
      const date = Date.parse(candidate.date);
      if (date < first - (incoming ? 120 : 30) * 86400000
        || date > last + (incoming ? 30 : 120) * 86400000)
        return [];
      let fits: [string, number][];
      if (group.length === 1) {
        const expense = incoming ? candidate : group[0];
        const payer = incoming ? group[0] : candidate;
        const rest = remaining(expense);
        const original = cents(Math.abs(expense.amount));
        fits = [
          ["whole", original],
          ["half", Math.round(original / 2)],
          ["third", Math.round(original / 3)],
          ["quarter", Math.round(original / 4)],
          ["rest", rest]
        ];
        const match = fits.find(([, n]) => n > 0 && n <= rest && Math.abs(remaining(payer) - n) <= 1);
        return [
          {
            id: candidate.id,
            fit: match?.[0] ?? null,
            amount: Math.min(remaining(payer), rest, match?.[1] ?? Infinity) / 100,
            distance: Math.abs(days)
          }
        ];
      }
      fits = incoming
        ? [["whole", total], ["half", total * 2]]
        : [
          ["whole", total],
          ["half", Math.round(total / 2)],
          ["third", Math.round(total / 3)],
          ["quarter", Math.round(total / 4)]
        ];
      const match = fits.find(([, n]) => n > 0 && Math.abs(remaining(candidate) - n) <= 1);
      return [
        {
          id: candidate.id,
          fit: match?.[0] ?? null,
          amount: Math.min(remaining(candidate), total) / 100,
          distance: Math.abs(days)
        }
      ];
    }).sort(
      (a, b) => Number(!!b.fit) - Number(!!a.fit) || a.distance - b.distance
        || dashboard.transactions.find((p) => p.id === b.id)!.date.localeCompare(
          dashboard.transactions.find((p) => p.id === a.id)!.date)
        || a.id.localeCompare(b.id)).slice(0, 8);
  return {
    group,
    candidates,
    suggestions,
    rest: total / 100,
    skipped: selected.length - group.length
  };
}
export function planPaybacks(dashboard: PaybackDashboard, ids: string[], others: string[], typedAmount?: number) {
  const choices = paybackChoices(dashboard, ids);
  const selected = new Set(others);
  if (selected.size !== others.length || !others.length)
    throw new Error("invalid-payment");
  const picked = choices.candidates.filter((p) => selected.has(p.id));
  if (picked.length !== others.length)
    throw new Error("invalid-payment");
  const expenses = (choices.group[0].amount < 0 ? choices.group : picked).slice().sort(compare);
  const paymentsIn = (choices.group[0].amount > 0 ? choices.group : picked).slice().sort(compare);
  if (typedAmount !== undefined
    && (expenses.length !== 1 || paymentsIn.length !== 1 || !centAmount(typedAmount)
      || typedAmount <= 0
      || cents(typedAmount) > Math.min(remaining(expenses[0]), remaining(paymentsIn[0]))))
    throw new Error("invalid-amount");
  const open = expenses.map(remaining);
  const available = paymentsIn.map(remaining);
  const originalOpen = open.slice();
  const originalAvailable = available.slice();
  const links: PlanLink[] = [];
  let e = 0;
  let p = 0;
  while (e < expenses.length && p < paymentsIn.length) {
    if (!open[e]) {
      e++;
      continue;
    }
    if (!available[p]) {
      p++;
      continue;
    }
    const amount = typedAmount === undefined ? Math.min(open[e], available[p]) : cents(typedAmount);
    const from = paymentsIn[p];
    const to = expenses[e];
    const previous = from.paysBack?.find((link) => link.payment === to.id)?.amount ?? 0;
    links.push(
      {
        from: from.id,
        to: to.id,
        amount: amount / 100,
        totalAmount: (cents(previous) + amount) / 100
      });
    open[e] -= amount;
    available[p] -= amount;
    if (typedAmount !== undefined)
      break;
  }
  return {
    links,
    expenses: expenses.map(
      (p, i) => ({
        id: p.id,
        amount: (originalOpen[i] - open[i]) / 100,
        rest: open[i] / 100
      })),
    paymentsIn: paymentsIn.map(
      (p, i) => ({
        id: p.id,
        amount: (originalAvailable[i] - available[i]) / 100,
        rest: available[i] / 100
      })),
    linked: links.reduce((n, l) => n + cents(l.amount), 0) / 100,
    stillOpen: open.reduce((a, b) => a + b, 0) / 100,
    staysIncome: available.reduce((a, b) => a + b, 0) / 100
  };
}
export function applyPlan(links: Record<string, PaymentLink[]>, plan: ReturnType<typeof planPaybacks>) {
  const result = JSON.parse(JSON.stringify(links)) as Record<string, PaymentLink[]>;
  for (const link of plan.links) {
    if (!Object.hasOwn(result, link.from))
      Object.defineProperty(
        result,
        link.from,
        {
          value: [],
          enumerable: true,
          configurable: true,
          writable: true
        });
    const rows = result[link.from];
    const i = rows.findIndex((l) => l.payment === link.to);
    if (i < 0)
      rows.push({
        payment: link.to,
        amount: link.totalAmount
      }); else
      rows[i].amount = link.totalAmount;
  }
  return result;
}
