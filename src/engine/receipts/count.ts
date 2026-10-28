// Receipts and cash entries in the dashboard (buildDashboardSource, ../source.ts), so that no money counts twice
// (D8, 2026-10-27; D9, 2026-10-28):
// - a receipt joined to its bank payment adds nothing (the payment counts as it is);
// - a card receipt not joined yet counts on its own, marked provisional ("waiting for the bank statement");
// - cash received (`direction: "in"`, typed in by hand: a gift, money from selling something) counts as money in, in
//   its category on its day (with none, as any money in without a category: "Other" income, ../../data/dashboard.ts),
//   and is a source of cash, like a withdrawal;
// - cash spent (a cash receipt, or an entry typed in by hand, which works the same) counts on its own, in its category
//   on its day, and takes its amount from the sources of cash: the withdrawals (the shop list's cash rule) and the cash
//   received. First from the source it names (`paidFrom`), when that is on or before its day and has money left; then,
//   for the rest, from the latest source on or before its day, then the ones before it, at most CASH_LOOKBACK_DAYS back
//   (Claude's call, 2026-10-28: most cash never gets a receipt, so "the oldest first" would pile today's receipts onto
//   months long past and change them). What no source covers is spending of its own (cash from elsewhere).
//   What it takes from a withdrawal shows as one row per withdrawal, in the withdrawal's own category and month: a
//   positive amount, so that category shows only the cash without a receipt and the total spending stays the same.
//   What it takes from cash received needs no row: that cash counted as income, and its spending counts where it is.
// - The Cash page (`cashView`) lists every cash movement from the wallet's side. It is a view and counts nowhere.
import type { CashMonth, CashMovement, CashView } from "../../data/dashboard.js";
import { dayNumber, parseDay } from "../dates.js";
import { findShop } from "../sorting/starter-rules.js";
import type { SourcePayment, SourceReceipt } from "../source.js";

/** The dashboard's money. A receipt in another currency counts only once the app has its euro amount. */
export const DASHBOARD_CURRENCY = "EUR";
/** How far back cash spent looks by itself for the source it was paid from: about three months. */
export const CASH_LOOKBACK_DAYS = 92;
/** The place shown on a withdrawal's covered row (the app may show its own words for it: the row has `coveredBy`). */
export const COVERED_PLACE = "Covered by receipts";

/** A row counted besides the payments, in the payments' shape, with what marks it in the dashboard. */
export type ReceiptRow = SourcePayment & { provisional?: true; receiptId?: string; coveredBy?: string[] };

/** A source of cash: a withdrawal or cash received, with what cash spent took from it. Amounts in cents. */
type CashSource = {
  kind: "withdrawal" | "received";
  id: string; date: string; day: number; place: string; category: string | null;
  amount: number;
  /** What it still holds. */
  left: number;
  /** The receipts and entries that took from it, in the order they took. */
  by: string[];
  /** The withdrawal's payment (for its covered row); null for cash received. */
  payment: SourcePayment | null;
};
/** Cash spent: a cash receipt or an entry by hand, with the sources it took from. Amounts in cents. */
type CashOut = {
  kind: "receipt" | "manual";
  id: string; date: string; place: string; category: string | null;
  amount: number;
  /** The sources it took from, in the order it took. */
  from: string[];
};
/** What the receipts add to the dashboard, and the pool behind it (for the Cash page). */
export type ReceiptCount = {
  /** The rows counted besides the payments. */
  rows: ReceiptRow[];
  /** The payments that are cash withdrawals (the dashboard marks them `cashWithdrawal`). */
  withdrawals: ReadonlySet<SourcePayment>;
  sources: readonly CashSource[];
  outs: readonly CashOut[];
};

const cents = (n: number) => Math.round(n * 100);
const day = (date: string) => date.slice(0, 10);
const byDay = <T extends { date: string }>(a: T, b: T) => (day(a.date) < day(b.date) ? -1 : day(a.date) > day(b.date) ? 1 : 0);

function checked(receipts: readonly SourceReceipt[]): SourceReceipt[] {
  for (const r of receipts) {
    if (!parseDay(r?.date)) throw new Error(`Receipt ${r?.id}: the date is not an ISO date (YYYY-MM-DD)`);
    if (typeof r.total !== "number" || !Number.isFinite(r.total)) throw new Error(`Receipt ${r.id}: the total is not a number`);
    if (r.method !== "card" && r.method !== "cash") throw new Error(`Receipt ${r.id}: the method is neither card nor cash`);
    if (r.direction != null && r.direction !== "out" && r.direction !== "in") throw new Error(`Receipt ${r.id}: the direction is neither out nor in`);
    if (r.direction === "in" && r.method !== "cash") throw new Error(`Receipt ${r.id}: money received is cash only`);
    if (r.kind != null && r.kind !== "receipt" && r.kind !== "manual") throw new Error(`Receipt ${r.id}: the kind is neither receipt nor manual`);
    if (r.paidFrom != null && typeof r.paidFrom !== "string") throw new Error(`Receipt ${r.id}: paidFrom is not an id`);
  }
  return receipts.filter((r) => r.total > 0);
}

/** A cash withdrawal: money out that the shop list's cash rule names (Geldautomat, Bargeldauszahlung, ATM, …). */
export const isCashWithdrawal = (p: SourcePayment) =>
  p.amount < 0 && findShop({ counterparty: p.counterparty, description: p.description, amount: p.amount })?.categoryId === "cash";

/**
 * How the receipts and cash entries count (`payments`: what the dashboard counts, in date order). `paymentIds` are all
 * stored payments' ids: a receipt joined to a payment that is gone counts as not joined.
 */
export function countReceipts(payments: readonly SourcePayment[], receipts: readonly SourceReceipt[], paymentIds: ReadonlySet<string>): ReceiptCount {
  const rows: ReceiptRow[] = [];
  const row = (r: SourceReceipt, amount: number): ReceiptRow => ({
    id: r.id, externalId: "", date: day(r.date), amount, currency: DASHBOARD_CURRENCY, balance: null,
    description: r.shop ?? "", counterparty: r.shop ?? "", category: r.category, receiptId: r.id,
  });
  const received: SourceReceipt[] = [];
  const spent: SourceReceipt[] = [];
  for (const r of checked(receipts)) {
    if (r.paymentId != null && paymentIds.has(r.paymentId)) continue; // joined: the payment counts
    if ((r.currency || DASHBOARD_CURRENCY).toUpperCase() !== DASHBOARD_CURRENCY) continue;
    if (r.method === "card") rows.push({ ...row(r, -r.total), provisional: true });
    else if (r.direction === "in") { rows.push(row(r, r.total)); received.push(r); }
    else { rows.push(row(r, -r.total)); spent.push(r); }
  }

  // The pool: the withdrawals (in date order), then the cash received.
  const number = (date: string) => dayNumber(parseDay(date)!);
  const withdrawals = payments.filter(isCashWithdrawal);
  const source = (kind: CashSource["kind"], id: string, date: string, euros: number, place: string,
    category: string | null, payment: SourcePayment | null): CashSource =>
    ({ kind, id, date: day(date), day: number(date), place, category, amount: cents(euros), left: cents(euros), by: [], payment });
  const sources = [
    ...withdrawals.map((p) => source("withdrawal", p.id, p.date, -p.amount, p.counterparty || p.description, p.category, p)),
    ...received.map((r) => source("received", r.id, r.date, r.total, r.shop ?? "", r.category, null)),
  ];
  const named = new Map<string, CashSource>();
  for (const s of sources) if (!named.has(s.id)) named.set(s.id, s);
  // The latest first; on one day as listed (withdrawals before cash received).
  const latestFirst = [...sources].sort((a, b) => b.day - a.day);

  // Cash spent, in date order, takes from the pool.
  const outs = [...spent].sort(byDay).map((r): CashOut => {
    let need = cents(r.total);
    const on = number(r.date);
    const from: string[] = [];
    const take = (s: CashSource) => {
      const amount = Math.min(s.left, need);
      s.left -= amount; need -= amount;
      s.by.push(r.id); from.push(s.id);
    };
    const chosen = r.paidFrom != null ? named.get(r.paidFrom) : undefined;
    if (chosen && chosen.day <= on && chosen.left > 0) take(chosen);
    for (const s of latestFirst) {
      if (need === 0) break;
      if (s.left === 0 || s.day > on || on - s.day > CASH_LOOKBACK_DAYS) continue;
      take(s);
    }
    return { kind: r.kind === "manual" ? "manual" : "receipt", id: r.id, date: day(r.date), place: r.shop ?? "",
      category: r.category, amount: cents(r.total), from };
  });

  for (const s of sources) {
    if (s.payment === null || s.left === s.amount) continue;
    rows.push({
      id: `${s.id}:covered`, externalId: "", date: s.date, amount: (s.amount - s.left) / 100, currency: DASHBOARD_CURRENCY,
      balance: null, description: COVERED_PLACE, counterparty: COVERED_PLACE, category: s.payment.category,
      tags: [...(s.payment.tags ?? [])], coveredBy: [...s.by],
    });
  }
  return { rows, withdrawals: new Set(withdrawals), sources, outs };
}

/** Payments and receipt rows in one date order: on the same day the payments first, as they were. */
export function withReceiptRows(payments: readonly SourcePayment[], rows: readonly ReceiptRow[]): ReceiptRow[] {
  const extra = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const merged: ReceiptRow[] = [];
  let next = 0;
  for (const p of payments) {
    while (next < extra.length && extra[next].date < day(p.date)) merged.push(extra[next++]);
    merged.push(p);
  }
  return merged.concat(extra.slice(next));
}

/**
 * The Cash page: every cash movement from the wallet's side, and per month what came in, went out and is not
 * accounted for. `categoryName` names a category as the dashboard does.
 */
export function cashView(count: ReceiptCount, categoryName: (category: string | null) => string): CashView {
  const ins = count.sources.map((s): CashMovement => ({
    id: s.id, date: s.date, amount: s.amount / 100, kind: s.kind, place: s.place, category: categoryName(s.category),
    paidFrom: null, coveredBy: [...s.by], left: s.left / 100,
  }));
  const outs = count.outs.map((o): CashMovement => ({
    id: o.id, date: o.date, amount: -o.amount / 100, kind: o.kind, place: o.place, category: categoryName(o.category),
    paidFrom: [...o.from], coveredBy: null, left: null,
  }));
  // A stable sort: on one day the money in first (withdrawals, then cash received), then the money out.
  const movements = [...ins, ...outs].sort(byDay);

  const tally = new Map<string, CashMonth>(); // in cents until the end
  for (const m of movements) {
    const key = m.date.slice(0, 7);
    const month = tally.get(key) ?? { withdrawn: 0, received: 0, spent: 0, unaccounted: 0 };
    tally.set(key, month);
    const amount = cents(Math.abs(m.amount));
    if (m.kind === "withdrawal") { month.withdrawn += amount; month.unaccounted += cents(m.left!); }
    else if (m.kind === "received") month.received += amount;
    else month.spent += amount;
  }
  const months: Record<string, CashMonth> = {};
  for (const [key, m] of tally) {
    months[key] = { withdrawn: m.withdrawn / 100, received: m.received / 100, spent: m.spent / 100, unaccounted: m.unaccounted / 100 };
  }
  return { months, movements };
}
