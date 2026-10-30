// Operator-only, read-only comparison. No database access and no payment values in the output.
// Before changing the server checkout: `npm run engine`, save dist/aresium-engine.js outside the repo.
// Build the new bundle, then run:
// npx tsx scripts/check-shop-sorting.ts /private/before.js dist/aresium-engine.js /private/snapshot.json
// snapshot.json: { payments: TransferPayment[], categories: { id: string }[], learned: Record<string, string> }.
// Use one frozen snapshot for both engines. Keep old learned keys; also rebuild new card keys from manual
// corrections, as the phone does. Never copy server input to a developer machine. Review only aggregate counts.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createContext, runInContext } from "node:vm";
import { cardMerchant, payeeText } from "../src/engine/sorting/merchant.js";
import type { Learned } from "../src/engine/sorting/sort.js";
import type { TransferPayment } from "../src/engine/sorting/transfers.js";

type SortingEngine = Pick<typeof import("../src/engine/index.js"), "merchantKey" | "sortPayments">;
type Snapshot = { payments: TransferPayment[]; categories: { id: string }[]; learned?: Learned };

export function compareShopSorting(before: SortingEngine, after: SortingEngine, snapshot: Snapshot) {
  const { payments, categories, learned = {} } = snapshot;
  const options = { categories, learned };
  const oldKeys = payments.map(before.merchantKey), newKeys = payments.map(after.merchantKey);
  const previous = before.sortPayments(payments, options), next = after.sortPayments(payments, options);
  const oldStarters = before.sortPayments(payments, { categories }), newStarters = after.sortPayments(payments, { categories });
  const foreignCards = payments.map((payment) => {
    const text = payeeText(payment);
    return /\bkurs\s*:?|auslandsums/u.test(text) && cardMerchant(text) !== null;
  });
  const hasForeignCard = payments.some((payment) => [payment.counterparty, payment.description, payment.bookingText]
    .some((text) => text && /\bkurs\s*:?|auslandsums/iu.test(text) && cardMerchant(text) !== null));
  const counts = { payments: payments.length, unchanged: 0, newlySorted: 0, lostCategories: 0, keyChanges: 0,
    identityLearningChanges: 0, cardKeySortingChanges: 0, cardOrTownStarterChanges: 0,
    unexpectedKeyChanges: 0, unexpectedSortingChanges: 0 };
  const same = (a: typeof previous[number], b: typeof previous[number]) => a.categoryId === b.categoryId && a.source === b.source;
  payments.forEach((_, i) => {
    const changedKey = oldKeys[i] !== newKeys[i];
    if (changedKey) {
      counts.keyChanges++;
      if (!foreignCards[i]) counts.unexpectedKeyChanges++;
    }
    const old = previous[i], current = next[i];
    if (same(old, current)) { counts.unchanged++; return; }
    if (old.categoryId === null && current.categoryId !== null) counts.newlySorted++;
    if (old.categoryId !== null && current.categoryId === null) counts.lostCategories++;
    if (old.source === "structural" || current.source === "structural") counts.unexpectedSortingChanges++;
    else if (changedKey && foreignCards[i]) counts.cardKeySortingChanges++;
    else if (old.source === "learned") counts.unexpectedSortingChanges++;
    else if (current.source === "learned" && !Object.hasOwn(learned, newKeys[i])) counts.identityLearningChanges++;
    else if (hasForeignCard && !same(oldStarters[i], newStarters[i])) counts.cardOrTownStarterChanges++;
    else counts.unexpectedSortingChanges++;
  });
  return counts;
}

async function main() {
  try {
    const paths = process.argv.slice(2);
    if (paths.length !== 3) throw new Error();
    const [oldCode, newCode, input] = await Promise.all(paths.map((path) => readFile(path, "utf8")));
    const load = (code: string): SortingEngine => {
      const context = createContext({});
      runInContext(code, context);
      return context.AresiumEngine as SortingEngine;
    };
    const counts = compareShopSorting(load(oldCode), load(newCode), JSON.parse(input) as Snapshot);
    console.log(JSON.stringify(counts, null, 2));
    // Card/town changes and identity overrides of starters need operator review even when this passes.
    if (counts.unexpectedKeyChanges || counts.unexpectedSortingChanges || counts.lostCategories) process.exitCode = 1;
  } catch {
    console.error("Comparison failed. Supply before bundle, after bundle and a sorting snapshot JSON file.");
    process.exitCode = 1;
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
