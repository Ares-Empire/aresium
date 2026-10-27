// Stored payments → the dashboard's source (DashboardSource), the step before buildDashboard. Pure: inputs in,
// result out, no clock. The server runs it on its database rows (src/data/queries.ts → getDashboardSource, which
// applies its icons and colours first); the iPhone app runs it on the payments it stores.
import type { Category, DashboardSource, Month, SourceTxn } from "../data/dashboard.js";
import { foldPaypalConversions, isPaypalBankFunding } from "./paypal.js";
import { daysInMonth, parseDay } from "./dates.js";
import { receiptRows, withReceiptRows, type ReceiptRow } from "./receipts/count.js";

/** One stored payment, as plain JSON. */
export type SourcePayment = {
  /** The stored payment's id; the dashboard's transactions carry it. */
  id: string;
  /** The export's own id; PayPal's currency conversions name their purchase by it. */
  externalId: string;
  /** Booking date: `YYYY-MM-DD`, or a UTC ISO timestamp (its first ten characters are the day). */
  date: string;
  /** Negative = money out, in `currency`. */
  amount: number;
  currency: string;
  /** The account's balance after this payment, when the export gives one (banks do, PayPal does not). */
  balance?: number | null;
  description: string;
  counterparty?: string | null;
  city?: string | null;
  /** The export's original row (PayPal's conversion and funding rows are recognised by it). */
  raw?: unknown;
  /** The category's name (one of `categories`), or null while it has none. */
  category: string | null;
  /** Names of the extra ("Add") categories it is also listed under; its amount is never counted twice. */
  tags?: string[];
};

/** A category on the person's list, with its look. */
export type SourceCategory = { name: string; icon: string; color: string; excludeFromTotals: boolean };

/** A stored receipt (brief 30), as plain JSON. */
export type SourceReceipt = {
  id: string;
  /** The purchase day, `YYYY-MM-DD`. */
  date: string;
  /** The amount paid, in `currency`; a cash receipt in another currency arrives with its euro amount from the app. */
  total: number;
  currency: string;
  method: "card" | "cash";
  /** The category's name (one of `categories`), or null while it has none. */
  category: string | null;
  shop: string | null;
  /** The bank payment it is joined to; null while it has none. */
  paymentId: string | null;
};

export type DashboardSourceInput = {
  transactions: readonly SourcePayment[];
  categories: readonly SourceCategory[];
  /** Today as `YYYY-MM-DD` (UTC): the current month is partial and counts up to this day. */
  today: string;
  /** The phone's receipts (./receipts/count.ts says how they count). Without them nothing changes. */
  receipts?: readonly SourceReceipt[];
};

/** The entry for payments without a category. The server's own look for the name follows it (CAT_META). */
export const UNCATEGORISED: Readonly<Category> = Object.freeze({ name: "Uncategorised", icon: "CircleHelp", color: "#9ca3af", kind: "spend" });
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

// The server's rows arrive ordered by booking date; the phone's may not. A stable sort leaves rows already in
// order exactly as they are, so the server's numbers do not change.
const byDate = (a: SourcePayment, b: SourcePayment) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

function checked(transactions: readonly SourcePayment[]): SourcePayment[] {
  for (const p of transactions) {
    if (!parseDay(p.date)) throw new Error(`Payment ${p.id}: the date is not an ISO date (YYYY-MM-DD)`);
    if (typeof p.amount !== "number" || !Number.isFinite(p.amount)) throw new Error(`Payment ${p.id}: the amount is not a number`);
  }
  return [...transactions].sort(byDate);
}

// What the dashboard counts: PayPal's bank-funding rows left out, foreign-currency purchases at their euro cost.
const counted = (ordered: SourcePayment[]) => foldPaypalConversions(ordered.filter((p) => !isPaypalBankFunding(p)));

/** PayPal purchases in a foreign currency that have no euro conversion row (their export ids), for a warning. */
export function unmatchedPaypalConversions(transactions: readonly SourcePayment[]): string[] {
  return counted(checked(transactions)).unmatched;
}

export function buildDashboardSource(input: DashboardSourceInput): DashboardSource {
  const today = parseDay(input.today);
  if (!today) throw new Error("today is not an ISO date (YYYY-MM-DD)");
  const stored = counted(checked(input.transactions)).rows;
  const payments: ReceiptRow[] = input.receipts?.length
    ? withReceiptRows(stored, receiptRows(stored, input.receipts, new Set(input.transactions.map((p) => p.id))))
    : stored;

  // A payment counts under its category; with none (or a name not on the list) it is "Uncategorised".
  const known = new Set(input.categories.map((c) => c.name));
  const categoryOf = (p: SourcePayment) => (p.category != null && known.has(p.category) ? p.category : null);

  // --- per-category net, to classify income vs spend (transfer = excludeFromTotals) ---
  const net = new Map<string, number>();
  let hasUncategorised = false;
  for (const p of payments) {
    const category = categoryOf(p);
    if (category === null) hasUncategorised = true;
    const name = category ?? UNCATEGORISED.name;
    net.set(name, (net.get(name) ?? 0) + p.amount);
  }
  const categories: Category[] = input.categories.map((c) => ({
    name: c.name, icon: c.icon, color: c.color,
    kind: c.excludeFromTotals ? "transfer" : (net.get(c.name) ?? 0) > 0 ? "income" : "spend",
  }));
  if (hasUncategorised) categories.push({ ...UNCATEGORISED });

  // --- transactions in the flat shape the dashboard expects ---
  const transactions: SourceTxn[] = payments.map((p) => ({
    id: p.id,
    date: p.date.slice(0, 10),
    amount: p.amount,
    categoryName: categoryOf(p) ?? UNCATEGORISED.name,
    tags: [...(p.tags ?? [])], // extra ("Add") categories: shown there, never re-summed into totals
    place: p.counterparty || p.description,
    city: p.city ?? "",
    // Receipts only (brief 30); payments never carry these, so the server's JSON stays as it was.
    ...(p.receiptId !== undefined ? { receiptId: p.receiptId } : {}),
    ...(p.provisional ? { provisional: true } : {}),
    ...(p.coveredBy ? { coveredBy: [...p.coveredBy] } : {}),
  }));

  // --- month list spanning the data range; the current month is partial ---
  const months: Month[] = [];
  if (payments.length) {
    const first = parseDay(payments[0].date)!;
    const last = parseDay(payments[payments.length - 1].date)!;
    let y = first.y, m = first.m - 1; // m: 0–11 from here on, as in Month
    while (y < last.y || (y === last.y && m <= last.m - 1)) {
      const isCurrent = y === today.y && m === today.m - 1;
      months.push({
        key: `${y}-${pad(m + 1)}`,
        label: `${MONTH_ABBR[m]} ${y}`,
        short: MONTH_ABBR[m],
        year: y, month: m,
        days: isCurrent ? today.d : daysInMonth(y, m + 1),
        partial: isCurrent,
      });
      m++; if (m > 11) { m = 0; y++; }
    }
  }

  // --- balance for every day in range (forward-filled from the bank's balance) ---
  const balanceByDay: Record<string, number> = {};
  let openingBalance = 0;
  if (months.length) {
    const balanceAt = new Map<string, number>(); // day -> last known balance that day
    for (const p of payments) if (p.balance != null) balanceAt.set(p.date.slice(0, 10), p.balance);
    const firstKnown = payments.find((p) => p.balance != null);
    openingBalance = firstKnown?.balance ?? 0;
    let balance = openingBalance;
    for (const mo of months) {
      for (let d = 1; d <= mo.days; d++) {
        const day = `${mo.key}-${pad(d)}`;
        if (balanceAt.has(day)) balance = balanceAt.get(day)!;
        balanceByDay[day] = balance;
      }
    }
  }

  return {
    categories, months, transactions, balanceByDay, openingBalance,
    databaseCategoryNames: input.categories.map((c) => c.name),
  };
}
