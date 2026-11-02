// Hand-made links between stored payments, after PayPal folding and before the dashboard counts them.
// Work in cents so many partial links cannot leave a fraction of a cent behind. Never alter the bank amounts.
import type { PaybackIgnored, PaybackMarks } from "../data/dashboard.js";
import { isCashWithdrawal } from "./receipts/count.js";
import type { SourceCategory, SourcePayment } from "./source.js";

const cents = (amount: number) => Math.round(amount * 100);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function countPaybacks(
  originals: readonly SourcePayment[], stored: readonly SourcePayment[], categories: readonly SourceCategory[],
): { marks: Map<string, PaybackMarks>; ignored: PaybackIgnored[] } {
  const marks = new Map<string, PaybackMarks>();
  const ignored: PaybackIgnored[] = [];
  const payers = originals.filter((p) => p.paysBack?.length).sort((a, b) =>
    compare(a.date.slice(0, 10), b.date.slice(0, 10)) || compare(a.id, b.id));
  if (!payers.length) return { marks, ignored };
  // Only stored, counted payments can be either end: receipts and covered cash rows never enter this map.
  const byId = new Map(stored.map((p) => [p.id, p]));
  const originalIds = new Set(originals.map((p) => p.id));
  const transfers = new Set(categories.filter((c) => c.excludeFromTotals).map((c) => c.name));
  const isTransfer = (p: SourcePayment) => p.category != null && transfers.has(p.category);
  const received = new Map<string, number>();

  for (const original of payers) {
    const payer = byId.get(original.id);
    const payerReason = !payer ? "payer-not-counted" : payer.amount <= 0 ? "payer-not-money-in"
      : isTransfer(payer) ? "payer-transfer" : payer.currency !== "EUR" ? "payer-not-euros" : null;
    if (!payer || payerReason) {
      for (const link of original.paysBack!) ignored.push({ from: original.id, to: link.payment, reason: payerReason ?? "payer-not-counted" });
      continue;
    }
    let paid = 0;
    for (const link of original.paysBack!) {
      const target = byId.get(link.payment);
      const reason: PaybackIgnored["reason"] | null = !target ? (originalIds.has(link.payment) ? "target-not-counted" : "target-missing")
        : target.amount >= 0 ? "target-not-money-out"
        : isTransfer(target) ? "target-transfer"
        : isCashWithdrawal(target) ? "target-withdrawal"
        : target.currency !== "EUR" ? "target-not-euros"
        : !Number.isFinite(link.amount) || link.amount <= 0 || cents(link.amount) <= 0 || !Number.isSafeInteger(cents(link.amount))
          || Math.abs(link.amount - cents(link.amount) / 100) > 1e-9 ? "invalid-amount" : null;
      if (!target || reason) {
        ignored.push({ from: original.id, to: link.payment, reason: reason ?? "target-missing" });
        continue;
      }
      const requested = cents(link.amount);
      const got = received.get(target.id) ?? 0;
      const applied = Math.min(requested, cents(payer.amount) - paid, -cents(target.amount) - got);
      if (applied < requested) ignored.push({ from: original.id, to: link.payment, reason: "clamped", amount: (requested - applied) / 100 });
      if (applied <= 0) continue;
      paid += applied;
      received.set(target.id, got + applied);
      const payerMarks = marks.get(original.id) ?? {};
      payerMarks.counted = (cents(payer.amount) - paid) / 100;
      (payerMarks.paysBack ??= []).push({ payment: target.id, amount: applied / 100 });
      marks.set(original.id, payerMarks);
      const targetMarks = marks.get(target.id) ?? {};
      targetMarks.counted = (cents(target.amount) + got + applied) / 100;
      targetMarks.paidBack = (got + applied) / 100;
      (targetMarks.paidBackBy ??= []).push({ payment: original.id, amount: applied / 100 });
      marks.set(target.id, targetMarks);
    }
  }
  return { marks, ignored };
}
