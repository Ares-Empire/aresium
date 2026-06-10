// Quick terminal overview of what's in the database — a stopgap until the web dashboard.
// Run: npm run summary
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

const total = await prisma.transaction.count();
if (total === 0) {
  console.log("No transactions yet. Drop exports in imports/ and run `npm run import`.");
  await prisma.$disconnect();
  process.exit(0);
}

const range = await prisma.transaction.aggregate({
  _min: { bookingDate: true },
  _max: { bookingDate: true },
});
const accounts = await prisma.account.findMany({
  include: { _count: { select: { transactions: true } } },
});

console.log(
  `\n${total} transactions  |  ${range._min.bookingDate?.toISOString().slice(0, 10)} → ${range._max.bookingDate
    ?.toISOString()
    .slice(0, 10)}\n`,
);
console.log("Accounts:");
for (const a of accounts) console.log(`  ${a.name.padEnd(22)} ${a._count.transactions}`);

const cats = await prisma.category.findMany({ include: { transactions: true } });
const rows = cats
  .map((c) => ({
    name: `${c.icon ?? ""} ${c.name}`,
    sum: c.transactions.reduce((s, t) => s + Number(t.amount), 0),
    n: c.transactions.length,
  }))
  .filter((r) => r.n > 0)
  .sort((a, b) => a.sum - b.sum);

console.log("\nBy category (sum of signed amounts):");
for (const r of rows) {
  console.log(`  ${r.name.padEnd(22)} ${r.sum.toFixed(2).padStart(12)} EUR  (${r.n})`);
}

const uncat = await prisma.transaction.count({ where: { categorized: false } });
console.log(`\nUncategorised: ${uncat} (add rules in scripts/seed-categories.ts, re-run npm run seed + import)`);
await prisma.$disconnect();
