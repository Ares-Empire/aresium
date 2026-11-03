import type { BalanceUncertainDay, Month } from "../data/dashboard.js";
import type { SourcePayment } from "./source.js";

export type AccountClosing = BalanceUncertainDay & { balance: number; uncertain: boolean };
type Booking = SourcePayment & { balance: number };
const cents = (amount: number) => Math.round(amount * 100);

// Each booking is an edge from its balance before to its balance after. A connected graph with one start
// and one end has a complete booking chain, even when repeated balances allow several intermediate orders.
// A circuit with several balance values has no identifiable end without the statement's own order.
function chainClosing(rows: Booking[]): number | null {
  const degree = new Map<number, number>();
  const neighbours = new Map<number, number[]>();
  for (const row of rows) {
    const after = cents(row.balance);
    const before = after - cents(row.amount);
    degree.set(before, (degree.get(before) ?? 0) + 1);
    degree.set(after, (degree.get(after) ?? 0) - 1);
    const outgoing = neighbours.get(before) ?? [];
    outgoing.push(after);
    neighbours.set(before, outgoing);
    const incoming = neighbours.get(after) ?? [];
    incoming.push(before);
    neighbours.set(after, incoming);
  }
  const pending = [cents(rows[0].balance)];
  const visited = new Set<number>();
  while (pending.length) {
    const value = pending.pop()!;
    if (visited.has(value)) continue;
    visited.add(value);
    for (const next of neighbours.get(value) ?? []) {
      if (!visited.has(next)) pending.push(next);
    }
  }
  if (visited.size !== degree.size) return null;
  const starts = [...degree].filter(([, value]) => value === 1);
  const ends = [...degree].filter(([, value]) => value === -1);
  if ([...degree.values()].some((value) => Math.abs(value) > 1)) return null;
  if (starts.length === 1 && ends.length === 1) return ends[0][0] / 100;
  if (degree.size === 1) return rows[0].balance;
  return null;
}

function closing(rows: Booking[]): { balance: number; uncertain: boolean } {
  // Only complete, unique statement positions are comparable. Partial positions cannot order other rows.
  const hasOrder = rows.every((row) => Number.isSafeInteger(row.statementOrder))
    && new Set(rows.map((row) => row.statementOrder)).size === rows.length;
  if (hasOrder) {
    const ordered = rows.slice().sort((a, b) => a.statementOrder! - b.statementOrder!);
    const uncertain = ordered.some((row, i) => i > 0
      && cents(row.balance) - cents(row.amount) !== cents(ordered[i - 1].balance));
    return { balance: ordered[ordered.length - 1].balance, uncertain };
  }
  const derived = chainClosing(rows);
  return {
    balance: derived ?? rows[rows.length - 1].balance,
    uncertain: derived === null,
  };
}

/** Original, unfiltered bookings only. Fallback order is the caller's stored order within the booking day. */
export function accountDayClosings(payments: readonly SourcePayment[]): AccountClosing[] {
  const accounts = new Map<string | null, Map<string, Booking[]>>();
  for (const payment of payments) {
    if (payment.balance == null) continue;
    if (!Number.isFinite(payment.balance)) throw new Error(`Payment ${payment.id}: the balance is not a number`);
    const accountId = payment.accountId ?? null;
    const days = accounts.get(accountId) ?? new Map<string, Booking[]>();
    const day = payment.date.slice(0, 10);
    const rows = days.get(day) ?? [];
    rows.push(payment as Booking);
    days.set(day, rows);
    accounts.set(accountId, days);
  }
  const result: AccountClosing[] = [];
  for (const [accountId, days] of accounts) {
    for (const [date, rows] of days) result.push({ accountId, date, ...closing(rows) });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date)
    || (a.accountId ?? "").localeCompare(b.accountId ?? ""));
}

/** Carry each known account independently, including bookings before the dashboard's spending range. */
export function accountBalanceSeries(payments: readonly SourcePayment[], months: readonly Month[]) {
  const closings = accountDayClosings(payments);
  const known = new Map<string | null, number>();
  const sum = () => known.size ? [...known.values()].reduce((total, value) => total + value, 0) / 100 : null;
  const balanceByDay: Record<string, number | null> = {};
  let index = 0;
  const firstDay = months.length ? `${months[0].key}-01` : "";
  while (index < closings.length && closings[index].date < firstDay) {
    const row = closings[index++];
    known.set(row.accountId, cents(row.balance));
  }
  const openingBalance = sum();
  for (const month of months) {
    for (let d = 1; d <= month.days; d++) {
      const day = `${month.key}-${String(d).padStart(2, "0")}`;
      while (index < closings.length && closings[index].date <= day) {
        const row = closings[index++];
        known.set(row.accountId, cents(row.balance));
      }
      balanceByDay[day] = sum();
    }
  }
  const uncertain = closings.filter((row) => row.uncertain).map(({ date, accountId }) => ({ date, accountId }));
  return { balanceByDay, openingBalance, ...(uncertain.length ? { balanceUncertainDays: uncertain } : {}) };
}
