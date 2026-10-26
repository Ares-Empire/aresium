// Own transfers: money that only moves between the person's own accounts. They go to the built-in category
// "own-transfers", so nothing is counted twice. Two structural rules, which sortPayments applies before learned and
// starter rules, because they look at the person's payments together rather than at one payment's text:
//
// 1. PayPal's bank lines. A person who imports both their bank's and their PayPal export sees each PayPal purchase
//    twice: in the PayPal export with the shop, and on the bank as the money moving into PayPal ("PayPal Europe
//    S.a.r.l. et Cie S.C.A … Ihr Einkauf bei <shop>"). When PayPal export rows are present, such bank lines are own
//    transfers. Without them the bank line is the only record of the purchase and is left to the other rules.
// 2. Between accounts. Two payments of the same absolute amount (and currency), with opposite signs, on different
//    accounts, at most 3 days apart, are the two sides of one transfer. Each payment pairs at most once; the
//    closest dates pair first, and among equally close pairs the earlier payments in the list.
import { dayNumber, parseDay } from "../dates.js";
import type { SortingPayment } from "./merchant.js";

export const OWN_TRANSFERS = "own-transfers";
export const TRANSFER_DAYS = 3;

/** A payment with what the transfer rules need. Without `account`, `amount` and `date` it never pairs. */
export type TransferPayment = SortingPayment & {
  /** The export it came from: "paypal" for PayPal's own export, "bank" for a bank's. */
  source?: "bank" | "paypal";
  /** The account it was booked on: any stable key (an IBAN, the app's account id). */
  account?: string | null;
  /** Negative = money out. */
  amount?: number;
  currency?: string | null;
  /** Booking date: `YYYY-MM-DD`, or an ISO timestamp (its first ten characters are the day). */
  date?: string;
};

/** Why a payment is an own transfer: a bank line of PayPal, or one side of a pair (`pairedWith` = the other's index). */
export type OwnTransfer = { rule: "paypal" } | { rule: "accounts"; pairedWith: number };

// How banks name PayPal on the bank side: "PayPal Europe S.a.r.l. et Cie S.C.A", "PayPal (Europe) S.a.r.l. et Cie,
// S.C.A.", "PAYPAL *SHOPNAME" on card statements, or just "PayPal". A shop whose name only starts with the same
// letters ("Paypalooza") or a text that merely mentions PayPal ("Geld zurück, PayPal ging nicht") is not PayPal.
const PAYPAL_NAME = /^paypal(?:$|[\s(*.,])/iu;
const PAYPAL_IN_TEXT = /(?:^|[^\p{L}\p{N}])paypal\s*(?:\(\s*europe|europe\b|\*)/iu;

/** A bank's line for money moving to or from PayPal (never a row of PayPal's own export). */
export function isPaypalBankLine(payment: TransferPayment): boolean {
  if (payment.source === "paypal") return false;
  const who = (payment.counterparty?.trim() || payment.description || payment.bookingText || "").trim();
  if (PAYPAL_NAME.test(who)) return true;
  return [payment.counterparty, payment.description, payment.bookingText]
    .some((text) => typeof text === "string" && PAYPAL_IN_TEXT.test(text));
}

type Side = { index: number; account: string; day: number; currency: string | null };

/** For each payment: why it is an own transfer, or null. Pass all of the person's payments: the rules look across them. */
export function ownTransfers(payments: readonly TransferPayment[]): (OwnTransfer | null)[] {
  const result: (OwnTransfer | null)[] = payments.map(() => null);

  if (payments.some((p) => p.source === "paypal")) {
    payments.forEach((p, i) => { if (isPaypalBankLine(p)) result[i] = { rule: "paypal" }; });
  }

  // Pairs: group by amount in cents, then match money out with money in on another account.
  const groups = new Map<number, { out: Side[]; in: Side[] }>();
  payments.forEach((p, index) => {
    const date = parseDay(p.date);
    const amount = p.amount;
    if (!p.account || !date || typeof amount !== "number" || !Number.isFinite(amount)) return;
    const day = dayNumber(date);
    const cents = Math.round(Math.abs(amount) * 100);
    if (cents === 0) return;
    const group = groups.get(cents) ?? { out: [], in: [] };
    (amount < 0 ? group.out : group.in).push({ index, account: p.account, day, currency: p.currency || null });
    groups.set(cents, group);
  });
  const candidates: { a: number; b: number; distance: number }[] = [];
  for (const { out, in: incoming } of groups.values()) {
    for (const o of out) {
      for (const i of incoming) {
        const distance = Math.abs(o.day - i.day);
        if (distance > TRANSFER_DAYS || o.account === i.account) continue;
        if (o.currency && i.currency && o.currency !== i.currency) continue;
        candidates.push({ a: Math.min(o.index, i.index), b: Math.max(o.index, i.index), distance });
      }
    }
  }
  candidates.sort((x, y) => x.distance - y.distance || x.a - y.a || x.b - y.b);
  const paired = new Set<number>();
  for (const { a, b } of candidates) {
    if (paired.has(a) || paired.has(b)) continue;
    paired.add(a).add(b);
    result[a] = { rule: "accounts", pairedWith: b };
    result[b] = { rule: "accounts", pairedWith: a };
  }
  return result;
}
