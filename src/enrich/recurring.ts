// Flags recurring/monthly payments (clever fit, Die Linke, Netflix, rent, ...).
// This is a TAG, not a second category — clever fit stays in Fitness AND is marked
// recurring, so a "Monthly payments" view sums them without double-counting.
import { prisma } from "../lib/db.js";

type Row = { id: string; counterparty: string | null; description: string; bookingDate: Date };

const normMerchant = (t: Row) =>
  (t.counterparty || t.description)
    .toLowerCase()
    .replace(/[^a-zäöüß ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 22);

export async function detectRecurring(): Promise<{ flagged: number; groups: { key: string; n: number }[] }> {
  await prisma.transaction.updateMany({ data: { recurring: false } });

  const txns = (await prisma.transaction.findMany({
    select: { id: true, counterparty: true, description: true, bookingDate: true },
  })) as Row[];

  const groups = new Map<string, Row[]>();
  for (const t of txns) {
    const key = normMerchant(t);
    if (key.length < 3) continue;
    const arr = groups.get(key);
    if (arr) arr.push(t);
    else groups.set(key, [t]);
  }

  let flagged = 0;
  const recurring: { key: string; n: number }[] = [];
  for (const [key, arr] of groups) {
    if (arr.length < 3) continue;
    arr.sort((a, b) => a.bookingDate.getTime() - b.bookingDate.getTime());
    const gaps: number[] = [];
    for (let i = 1; i < arr.length; i++) {
      gaps.push((arr[i].bookingDate.getTime() - arr[i - 1].bookingDate.getTime()) / 86_400_000);
    }
    const monthly = gaps.filter((g) => g >= 20 && g <= 40).length;
    if (monthly >= Math.max(2, Math.floor(gaps.length * 0.5))) {
      await prisma.transaction.updateMany({
        where: { id: { in: arr.map((t) => t.id) } },
        data: { recurring: true },
      });
      flagged += arr.length;
      recurring.push({ key, n: arr.length });
    }
  }

  return { flagged, groups: recurring.sort((a, b) => b.n - a.n) };
}
