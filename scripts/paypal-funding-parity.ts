// One-off (2026-10-27, brief 16): do PayPal's English funding names change which of the real database's payments the
// dashboard leaves out? Compares the rule before (only "Bankgutschrift auf PayPal") with src/engine/paypal.ts's on every
// stored payment and prints counts only. Read only. Expected on Patrik's German exports: 0 changed, so aresium.de's
// numbers stay as they are. Delete this script once it has run.
//
//   npx tsx scripts/paypal-funding-parity.ts
import "dotenv/config";
import { isPaypalBankFunding } from "../src/engine/paypal.js";
import { prisma } from "../src/lib/db.js";

const before = (t: { description: string; raw?: unknown }) =>
  (t.description + " " + JSON.stringify(t.raw ?? "")).toLowerCase().includes("bankgutschrift auf paypal");

try {
  const rows = await prisma.transaction.findMany({ select: { source: true, description: true, raw: true } });
  const changed = rows.filter((t) => before(t) !== isPaypalBankFunding(t));
  const bySource = (list: typeof rows) => `bank ${list.filter((t) => t.source === "bank").length}, paypal ${list.filter((t) => t.source === "paypal").length}`;
  console.log(`payments ${rows.length}; funding rows left out before ${rows.filter(before).length}, now ${rows.filter((t) => isPaypalBankFunding(t)).length}`);
  console.log(`changed ${changed.length} (${bySource(changed)}): ${changed.length === 0 ? "the dashboard is unchanged" : "NOT the same, look before merging"}`);
  if (changed.length) process.exitCode = 1;
} catch {
  console.error("Check failed; details withheld to protect payment data.");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
