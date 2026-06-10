// One-time backfill: populate `balance` on bank transactions that were imported
// before the field existed, by reading "Saldo nach Buchung" from their stored raw.
// Run: npm run backfill:balance
import "dotenv/config";
import { prisma } from "../src/lib/db.js";
import { parseAmount } from "../src/import/util.js";

const bank = await prisma.transaction.findMany({
  where: { source: "bank", balance: null },
  select: { id: true, raw: true },
});

let n = 0;
for (const t of bank) {
  const raw = t.raw as Record<string, string> | null;
  const saldo = raw?.["Saldo nach Buchung"] ?? raw?.["Saldo"];
  if (!saldo) continue;
  await prisma.transaction.update({ where: { id: t.id }, data: { balance: parseAmount(String(saldo)) } });
  n++;
}
console.log(`Backfilled balance on ${n} bank transactions.`);
await prisma.$disconnect();
