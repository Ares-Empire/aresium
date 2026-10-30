// Own transfers: money that only moves between the person's own accounts. They go to the built-in category
// "own-transfers", so nothing is counted twice. Structural rules, which sortPayments applies before learned and
// starter rules, because they look at the person's payments together rather than at one payment's text:
//
// 1. PayPal. A person who imports both their bank's and their PayPal export sees each PayPal purchase twice: in the
//    PayPal export with the shop, and on the bank as the money moving into PayPal ("PayPal Europe S.a.r.l. et Cie
//    S.C.A … Ihr Einkauf bei <shop>"). When PayPal export rows are present, such bank lines are own transfers.
//    Without them the bank line is the only record of the purchase and is left to the other rules. PayPal's own
//    funding rows ("Bankgutschrift auf PayPal-Konto", "Bank Deposit to PP Account", "General Card Deposit": the
//    same money arriving in PayPal, see ../paypal.ts) are own transfers too; the dashboard leaves them out.
//    Its currency-conversion rows are own transfers exactly when the dashboard folds them into the purchase.
// 2. Between accounts. Two payments of the same absolute amount (and currency), with opposite signs, on different
//    accounts, at most 3 days apart, are the two sides of one transfer, but only with proof that the money stayed
//    with the person: one side's `counterpartyIban` is the other side's account IBAN (either way round), or both
//    sides' texts say so themselves ("Umbuchung", "Übertrag", "Eigenübertrag", "Kontoübertrag", "eigenes Konto",
//    "own account"). Equal amounts alone are not enough: a 20.00 purchase and a friend paying back 20.00 the next
//    day on another account are not a transfer, and calling them one would hide real spending and income
//    (precision first). Each payment pairs at most once; the closest dates pair first, and among equally close
//    pairs the earlier payments in the list.
import { dayNumber, parseDay } from "../dates.js";
import { isPaypalBankFunding, isPaypalBankWithdrawal, paypalConversionRows } from "../paypal.js";
import type { SortingPayment } from "./merchant.js";

export const OWN_TRANSFERS = "own-transfers";
export const TRANSFER_DAYS = 3;

/** A payment with what the transfer rules need. Without `account`, `amount` and `date` it never pairs. */
export type TransferPayment = SortingPayment & {
  /** The export it came from: "paypal" for PayPal's own export, "bank" for a bank's. */
  source?: "bank" | "paypal";
  /** The account it was booked on: any stable key (an IBAN, the app's account id). */
  account?: string | null;
  /** The account's own IBAN (`BankFile.account.iban`). Not needed when `account` is the IBAN itself. */
  accountIban?: string | null;
  /** The other party's IBAN, as the readers give it (`BankTxn.counterpartyIban`). */
  counterpartyIban?: string | null;
  /** Negative = money out. */
  amount?: number;
  currency?: string | null;
  /** PayPal's transaction code, used to link its purchase and currency-conversion rows. */
  externalId?: string | null;
  /** Booking date: `YYYY-MM-DD`, or an ISO timestamp (its first ten characters are the day). */
  date?: string;
  /** The export's original row: PayPal's funding rows are also recognised by its type column. */
  raw?: unknown;
};

/**
 * Why a payment is an own transfer: PayPal's bank line, funding or conversion row, or one side of a pair between accounts
 * (`pairedWith` = the other side's index).
 */
export type OwnTransfer = { rule: "paypal" } | { rule: "paypal-conversion" } | { rule: "accounts"; pairedWith: number };

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

/** A row of PayPal's own export that funds PayPal from the person's bank account or card. */
export function isPaypalFundingRow(payment: TransferPayment): boolean {
  return payment.source === "paypal" && isPaypalBankFunding({ description: payment.description ?? "", raw: payment.raw });
}

/** PayPal's own withdrawal to the person's bank, including pending or removed withdrawals. */
export function isPaypalWithdrawalRow(payment: TransferPayment): boolean {
  return payment.source === "paypal" && isPaypalBankWithdrawal({ description: payment.description ?? "", raw: payment.raw });
}

// Words a bank or the person writes on a move between their own accounts, as whole words (so "Übertragung" or
// "Datenübertrag GmbH" do not count). Banks that cannot print umlauts write "ue".
const OWN_TRANSFER_WORDS =
  /(?<![\p{L}\p{N}])(?:umbuchung|(?:eigen|konto)?(?:übertrag|uebertrag)|eigene[ns]?\s+konto|own\s+account)(?![\p{L}\p{N}])/iu;

/** The payment's own texts say it moves money between the person's accounts. */
export function saysOwnTransfer(payment: SortingPayment): boolean {
  return [payment.counterparty, payment.description, payment.bookingText]
    .some((text) => typeof text === "string" && OWN_TRANSFER_WORDS.test(text.normalize("NFC")));
}

// IBANs compared without spaces and case; "" for none. An `account` key counts as the account's IBAN only when it
// looks like one.
const ibanKey = (value: string | null | undefined) => (value ?? "").replace(/\s/g, "").toUpperCase();
const IBAN_SHAPE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
function ownIban(payment: TransferPayment): string {
  const given = ibanKey(payment.accountIban);
  if (given) return given;
  const account = ibanKey(payment.account);
  return IBAN_SHAPE.test(account) ? account : "";
}

type Side = { index: number; account: string; day: number; currency: string | null; iban: string; other: string; says: boolean };

// The proof that two sides of equal amounts are one transfer between the person's own accounts.
const proven = (a: Side, b: Side) =>
  (a.other !== "" && a.other === b.iban) || (b.other !== "" && b.other === a.iban) || (a.says && b.says);

/** For each payment: why it is an own transfer, or null. Pass all of the person's payments: the rules look across them. */
export function ownTransfers(payments: readonly TransferPayment[]): (OwnTransfer | null)[] {
  const result: (OwnTransfer | null)[] = payments.map(() => null);

  const hasPaypalExport = payments.some((p) => p.source === "paypal");
  // The dashboard removes funding before folding conversions; use precisely the same input here.
  const conversions = paypalConversionRows(payments.filter((p) => !isPaypalBankFunding({ description: p.description ?? "", raw: p.raw })));
  payments.forEach((p, i) => {
    if (isPaypalFundingRow(p) || isPaypalWithdrawalRow(p) || (hasPaypalExport && isPaypalBankLine(p))) result[i] = { rule: "paypal" };
    if (conversions.has(p)) result[i] = { rule: "paypal-conversion" };
  });

  // Pairs: group by amount in cents, then match money out with money in on another account.
  const groups = new Map<number, { out: Side[]; in: Side[] }>();
  payments.forEach((p, index) => {
    if (result[index]?.rule === "paypal-conversion" || isPaypalWithdrawalRow(p)) return;
    const date = parseDay(p.date);
    const amount = p.amount;
    if (!p.account || !date || typeof amount !== "number" || !Number.isFinite(amount)) return;
    const cents = Math.round(Math.abs(amount) * 100);
    if (cents === 0) return;
    const group = groups.get(cents) ?? { out: [], in: [] };
    (amount < 0 ? group.out : group.in).push({
      index, account: p.account, day: dayNumber(date), currency: p.currency || null,
      iban: ownIban(p), other: ibanKey(p.counterpartyIban), says: saysOwnTransfer(p),
    });
    groups.set(cents, group);
  });
  const candidates: { a: number; b: number; distance: number }[] = [];
  for (const { out, in: incoming } of groups.values()) {
    for (const o of out) {
      for (const i of incoming) {
        const distance = Math.abs(o.day - i.day);
        if (distance > TRANSFER_DAYS || o.account === i.account) continue;
        if (o.currency && i.currency && o.currency !== i.currency) continue;
        if (!proven(o, i)) continue;
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
