import { prisma } from "../lib/db.js";

// Rule-based categorisation: for every not-yet-categorised transaction, find the
// highest-priority rule whose pattern appears in "description + counterparty".
// An LLM fallback for the leftovers can be added later (see docs/ROADMAP.md).
export async function categorizeAll(): Promise<void> {
  const rules = await prisma.categoryRule.findMany({ orderBy: { priority: "desc" } });
  if (rules.length === 0) {
    console.log("⚠️  No category rules defined yet — run `npm run seed` first.");
    return;
  }

  const uncategorized = await prisma.transaction.findMany({ where: { categorized: false } });
  let matched = 0;
  for (const tx of uncategorized) {
    const haystack = `${tx.description} ${tx.counterparty ?? ""}`.toLowerCase();
    const rule = rules.find((r) => haystack.includes(r.pattern.toLowerCase()));
    if (rule) {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { categoryId: rule.categoryId, categorized: true, categorySource: "rule" },
      });
      matched++;
    }
  }
  console.log(`Categorised ${matched}/${uncategorized.length} new transactions (rest left uncategorised).`);
}
