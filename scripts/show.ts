// Lists the transactions in a category, newest first (✈ = on a trip).
//   npm run show -- <Category Name>
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

const name = process.argv.slice(2).join(" ").trim();
if (!name) {
  console.log("usage: npm run show -- <Category Name>");
  process.exit(1);
}
const cat = await prisma.category.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
if (!cat) {
  console.log(`No category "${name}".`);
  process.exit(1);
}
const txns = await prisma.transaction.findMany({
  where: { categoryId: cat.id },
  orderBy: { bookingDate: "desc" },
});
console.log(`\n${cat.name}: ${txns.length} transactions\n`);
for (const t of txns) {
  const flag = t.trip ? "✈" : " ";
  console.log(
    `  ${t.id.slice(0, 8)} ${t.bookingDate.toISOString().slice(0, 10)} ${String(t.amount).padStart(9)} ${flag} ` +
      `${(t.counterparty || "").slice(0, 22).padEnd(22)} ${t.description.slice(0, 38).padEnd(38)} [${t.categorySource}]`,
  );
}
await prisma.$disconnect();
