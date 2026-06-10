// Terminal overview — separates real spending/income from excluded transfers,
// so the no-double-count setup is visible. Run: npm run summary
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

const txns = await prisma.transaction.findMany({ include: { category: true } });
if (txns.length === 0) {
  console.log("No transactions yet. Run `npm run import`.");
  await prisma.$disconnect();
  process.exit(0);
}

const excluded = (t: (typeof txns)[number]) => t.category?.excludeFromTotals ?? false;
const amt = (t: (typeof txns)[number]) => Number(t.amount);

const dates = txns.map((t) => t.bookingDate).sort((a, b) => a.getTime() - b.getTime());
const spending = txns.filter((t) => !excluded(t) && amt(t) < 0).reduce((s, t) => s + amt(t), 0);
const income = txns.filter((t) => !excluded(t) && amt(t) > 0).reduce((s, t) => s + amt(t), 0);
const transfers = txns.filter(excluded).reduce((s, t) => s + amt(t), 0);

console.log(
  `\n${txns.length} transactions  |  ${dates[0].toISOString().slice(0, 10)} → ${dates[dates.length - 1]
    .toISOString()
    .slice(0, 10)}\n`,
);
console.log(`  Income    ${income.toFixed(2).padStart(12)} EUR`);
console.log(`  Spending  ${spending.toFixed(2).padStart(12)} EUR`);
console.log(`  Net       ${(income + spending).toFixed(2).padStart(12)} EUR`);
console.log(`  (excluded transfers: ${transfers.toFixed(2)} EUR — kept out of the above)`);

// Per-category, excluded ones listed separately.
const byCat = new Map<string, { sum: number; n: number; excl: boolean }>();
for (const t of txns) {
  const key = t.category ? `${t.category.icon ?? ""} ${t.category.name}` : "— uncategorised";
  const e = byCat.get(key) || { sum: 0, n: 0, excl: excluded(t) };
  e.sum += amt(t);
  e.n += 1;
  byCat.set(key, e);
}
const rows = [...byCat.entries()].map(([name, v]) => ({ name, ...v }));

console.log("\nSpending/income categories:");
for (const r of rows.filter((r) => !r.excl).sort((a, b) => a.sum - b.sum)) {
  console.log(`  ${r.name.padEnd(22)} ${r.sum.toFixed(2).padStart(12)} EUR  (${r.n})`);
}
console.log("\nExcluded (transfers/investments):");
for (const r of rows.filter((r) => r.excl).sort((a, b) => a.sum - b.sum)) {
  console.log(`  ${r.name.padEnd(22)} ${r.sum.toFixed(2).padStart(12)} EUR  (${r.n})`);
}

const uncat = txns.filter((t) => !t.categorized).length;
console.log(`\nUncategorised: ${uncat} of ${txns.length} (${Math.round((uncat / txns.length) * 100)}%)`);
await prisma.$disconnect();
