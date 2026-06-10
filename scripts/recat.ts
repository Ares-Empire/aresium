// Manually set a transaction's category. Marked categorySource='manual', which rules
// and the LLM will never overwrite. Get ids from `npm run db:studio`.
//   npm run recat -- <transactionId> <Category Name>
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

const [id, ...rest] = process.argv.slice(2);
const name = rest.join(" ").trim();

if (!id || !name) {
  console.log("usage: npm run recat -- <transactionId> <Category Name>");
  process.exit(1);
}

const cat = await prisma.category.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
if (!cat) {
  const all = await prisma.category.findMany({ orderBy: { name: "asc" }, select: { name: true } });
  console.log(`No category "${name}". Existing: ${all.map((c) => c.name).join(", ")}`);
  process.exit(1);
}

await prisma.transaction.update({
  where: { id },
  data: { categoryId: cat.id, categorized: true, categorySource: "manual" },
});
console.log(`Set ${id} → ${cat.name} (manual).`);
await prisma.$disconnect();
