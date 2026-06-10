// Lists the most common uncategorised transactions, grouped by merchant, so we can
// add matching rules for the big ones. Run: npm run uncat
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

const uncat = await prisma.transaction.findMany({
  where: { categorized: false },
  select: { counterparty: true, description: true, amount: true },
});

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

// Group by counterparty when present; otherwise by the start of the description
// (VR card payments leave counterparty empty and put the merchant first in the text).
const groups = new Map<string, { n: number; sum: number; sample: string }>();
for (const t of uncat) {
  let key = t.counterparty?.trim() || norm(t.description).slice(0, 28);
  key = key.toUpperCase();
  const e = groups.get(key) || { n: 0, sum: 0, sample: norm(t.description).slice(0, 64) };
  e.n += 1;
  e.sum += Number(t.amount);
  groups.set(key, e);
}

const rows = [...groups.entries()]
  .map(([key, v]) => ({ key, ...v }))
  .sort((a, b) => b.n - a.n);

console.log(`\n${uncat.length} uncategorised — top ${Math.min(30, rows.length)} groups by count:\n`);
console.log("  #   sum(EUR)    merchant key                     | sample");
console.log("  " + "-".repeat(90));
for (const r of rows.slice(0, 30)) {
  console.log(
    `${String(r.n).padStart(3)}  ${r.sum.toFixed(2).padStart(10)}    ${r.key.padEnd(30).slice(0, 30)} | ${r.sample}`,
  );
}
await prisma.$disconnect();
