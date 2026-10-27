// Receipts in the dashboard (buildDashboardSource, ../source.ts), so that no money counts twice (D8, 2026-10-27):
// - a receipt joined to its bank payment adds nothing (the payment counts as it is);
// - a card receipt not joined yet counts on its own, marked provisional ("waiting for the bank statement");
// - a cash receipt counts on its own, in its category on its day, and takes its amount out of the cash withdrawals
//   on or before its day, the oldest first. What it takes shows as one row per withdrawal, in the withdrawal's own
//   category and month: a positive amount, so that category shows only the cash without a receipt and the total
//   spending stays the same. What no withdrawal covers is spending of its own (cash from elsewhere).
import { parseDay } from "../dates.js";
import { findShop } from "../sorting/starter-rules.js";
import type { SourcePayment, SourceReceipt } from "../source.js";

/** The dashboard's money. A receipt in another currency counts only once the app has its euro amount. */
export const DASHBOARD_CURRENCY = "EUR";
/** The place shown on a withdrawal's covered row (the app may show its own words for it: the row has `coveredBy`). */
export const COVERED_PLACE = "Covered by receipts";

/** A row counted besides the payments, in the payments' shape, with what marks it in the dashboard. */
export type ReceiptRow = SourcePayment & { provisional?: true; receiptId?: string; coveredBy?: string[] };

const cents = (n: number) => Math.round(n * 100);
const day = (date: string) => date.slice(0, 10);

function checked(receipts: readonly SourceReceipt[]): SourceReceipt[] {
  for (const r of receipts) {
    if (!parseDay(r?.date)) throw new Error(`Receipt ${r?.id}: the date is not an ISO date (YYYY-MM-DD)`);
    if (typeof r.total !== "number" || !Number.isFinite(r.total)) throw new Error(`Receipt ${r.id}: the total is not a number`);
    if (r.method !== "card" && r.method !== "cash") throw new Error(`Receipt ${r.id}: the method is neither card nor cash`);
  }
  return receipts.filter((r) => r.total > 0);
}

/** A cash withdrawal: money out that the shop list's cash rule names (Geldautomat, Bargeldauszahlung, ATM, …). */
export const isCashWithdrawal = (p: SourcePayment) =>
  p.amount < 0 && findShop({ counterparty: p.counterparty, description: p.description, amount: p.amount })?.categoryId === "cash";

/**
 * The rows receipts add to the counted payments (`payments`: what the dashboard counts, in date order). `paymentIds`
 * are all stored payments' ids: a receipt joined to a payment that is gone counts as not joined.
 */
export function receiptRows(payments: readonly SourcePayment[], receipts: readonly SourceReceipt[], paymentIds: ReadonlySet<string>): ReceiptRow[] {
  const rows: ReceiptRow[] = [];
  const row = (r: SourceReceipt): ReceiptRow => ({
    id: r.id, externalId: "", date: day(r.date), amount: -r.total, currency: DASHBOARD_CURRENCY, balance: null,
    description: r.shop ?? "", counterparty: r.shop ?? "", category: r.category, receiptId: r.id,
  });
  const cash: SourceReceipt[] = [];
  for (const r of checked(receipts)) {
    if (r.paymentId != null && paymentIds.has(r.paymentId)) continue; // joined: the payment counts
    if ((r.currency || DASHBOARD_CURRENCY).toUpperCase() !== DASHBOARD_CURRENCY) continue;
    if (r.method === "card") rows.push({ ...row(r), provisional: true });
    else { rows.push(row(r)); cash.push(r); }
  }

  // The pool: each withdrawal's amount, taken by the cash receipts in date order, oldest withdrawal first.
  const pool = payments.filter(isCashWithdrawal).map((p) => ({ payment: p, left: cents(-p.amount), taken: 0, by: [] as string[] }));
  const byDay = (a: SourceReceipt, b: SourceReceipt) => (day(a.date) < day(b.date) ? -1 : day(a.date) > day(b.date) ? 1 : 0);
  for (const r of [...cash].sort(byDay)) {
    let need = cents(r.total);
    for (const w of pool) {
      if (need === 0) break;
      if (w.left === 0 || day(w.payment.date) > day(r.date)) continue;
      const take = Math.min(w.left, need);
      w.left -= take; w.taken += take; need -= take;
      w.by.push(r.id);
    }
  }
  for (const w of pool) {
    if (w.taken === 0) continue;
    rows.push({
      id: `${w.payment.id}:covered`, externalId: "", date: day(w.payment.date), amount: w.taken / 100, currency: DASHBOARD_CURRENCY,
      balance: null, description: COVERED_PLACE, counterparty: COVERED_PLACE, category: w.payment.category,
      tags: [...(w.payment.tags ?? [])], coveredBy: w.by,
    });
  }
  return rows;
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
