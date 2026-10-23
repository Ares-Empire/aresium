// One-off (2026-10-22): re-sort existing rows to the new rules. Dry run by default; pass --apply.
//  1. Dev purchases → Development (+ Subscriptions tag for recurring ones), via the same
//     setTransactionTags() the web UI uses, so each move is logged as a CategoryCorrection.
//  2. PayPal double-counting: bank-side "PayPal Europe … Ihr Einkauf bei X" debits and PayPal
//     bank top-up rows → Transfer (excluded from totals). Done as a rule-level fix (no
//     correction log: logging "Lidl → Transfer" would teach the LLM the wrong thing).
import "dotenv/config";
import { prisma } from "../src/lib/db.js";
import { setTransactionTags } from "../src/data/queries.js";

const APPLY = process.argv.includes("--apply");
const DEV_AND_SUB = /claude sub|claude\.ai|hetzner|netcup|namecheap|webshare/i;
const DEV_ONLY = /anthropic|openai|leakcheck|have i been pwned/i;
const FUNDING = /bankgutschrift auf paypal|bank deposit to pp account/i;

async function main() {
  const [dev, sub, transfer] = await Promise.all(
    ["Development", "Subscriptions", "Transfer"].map((name) => prisma.category.findUniqueOrThrow({ where: { name } })),
  );
  const txs = await prisma.transaction.findMany({ include: { category: true, tags: true }, orderBy: { bookingDate: "asc" } });

  let moved = 0;
  for (const t of txs) {
    const text = `${t.description} ${t.counterparty ?? ""}`;
    const type = String((t.raw as Record<string, unknown>)?.["Typ"] ?? (t.raw as Record<string, unknown>)?.["Type"] ?? "");
    const isFunding = t.source === "paypal" && FUNDING.test(type);
    const isBankMirror = t.source === "bank" && /paypal/i.test(text);
    const line = `${t.bookingDate.toISOString().slice(0, 10)} ${t.source.padEnd(6)} ${String(t.amount).padStart(8)}  ${(t.counterparty || t.description).slice(0, 34).padEnd(34)} ${t.category?.name ?? "-"}`;

    if (isFunding || isBankMirror) {
      // Top-ups carry the type as description from now on (see paypal-csv.ts); align old rows.
      const description = isFunding ? type.trim() : t.description;
      if (t.categoryId === transfer.id && description === t.description) continue;
      console.log(`${line} → Transfer${isFunding ? " (top-up)" : " (bank copy)"}`);
      if (APPLY) {
        await prisma.$transaction([
          prisma.transaction.update({ where: { id: t.id }, data: { description, categoryId: transfer.id, categorized: true, categorySource: "rule" } }),
          prisma.transactionTag.deleteMany({ where: { transactionId: t.id } }),
        ]);
      }
      moved++;
      continue;
    }

    if (Number(t.amount) >= 0) continue; // purchases only; conversion/refund rows stay as they are
    const want = DEV_AND_SUB.test(text) ? [dev, sub] : DEV_ONLY.test(text) ? [dev] : null;
    if (!want) continue;
    const haveTags = t.tags.map((x) => x.categoryId).sort().join();
    const wantTags = want.slice(1).map((c) => c.id).sort().join();
    if (t.categoryId === dev.id && haveTags === wantTags) continue;
    console.log(`${line} → ${want.map((c) => c.name).join(" + ")}`);
    if (APPLY) await setTransactionTags(t.id, want.map((c) => c.name), true);
    moved++;
  }
  console.log(`\n${moved} rows ${APPLY ? "updated" : "would change (dry run; pass --apply)"}.`);
}

main().finally(() => prisma.$disconnect());
