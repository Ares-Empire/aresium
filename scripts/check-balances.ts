// Read-only server check. See docs/BALANCE-CHECK.md for the manifest and exact invocation.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { accountDayClosings, type AccountClosing } from "../src/engine/balances.js";
import { readBankFile } from "../src/engine/readers/read.js";
import type { BankTxn, CsvLayout } from "../src/engine/readers/types.js";
import { assertBalanceOnlyChanges } from "./balance-parity.js";

type StatementFile = {
  accountId: string;
  file: string;
  order: "oldest-first" | "newest-first";
  layouts?: CsvLayout[];
};
export type ExpectedClosing = { accountId: string; date: string; balance: number };
export type BalanceIssue = { accountId: string; date: string; reason: "missing" | "different" | "uncertain" };
const cents = (amount: number) => Math.round(amount * 100);

/** Bank file order is declared by the operator, independently of the engine's balance-chain calculation. */
export function statementClosings(rows: readonly BankTxn[], accountId: string, order: StatementFile["order"]) {
  if (order !== "oldest-first" && order !== "newest-first") throw new Error("Declare the bank file's row order");
  const ordered = order === "oldest-first" ? rows : rows.slice().reverse();
  const days = new Map<string, ExpectedClosing>();
  for (const row of ordered) {
    if (row.balance == null) continue;
    const balance = Number(row.balance);
    if (!Number.isFinite(balance)) throw new Error("Bank file has an invalid balance");
    const date = row.bookingDate.slice(0, 10);
    days.set(date, { accountId, date, balance });
  }
  if (!days.size) throw new Error("Bank file has no running balances; use an export with booked balances");
  return [...days.values()];
}

/** Require a closing on each statement booking day; a carried value could hide missing rows. */
export function compareClosings(actual: readonly AccountClosing[], expected: readonly ExpectedClosing[]) {
  const byAccount = new Map<string | null, Map<string, AccountClosing>>();
  for (const row of actual) {
    const days = byAccount.get(row.accountId) ?? new Map<string, AccountClosing>();
    days.set(row.date, row);
    byAccount.set(row.accountId, days);
  }
  const issues: BalanceIssue[] = [];
  for (const row of expected) {
    const found = byAccount.get(row.accountId)?.get(row.date);
    const reason = !found ? "missing" : cents(found.balance) !== cents(row.balance) ? "different"
      : found.uncertain ? "uncertain" : null;
    if (reason) issues.push({ accountId: row.accountId, date: row.date, reason });
  }
  return issues;
}

async function main(manifestPath: string) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { files: StatementFile[]; today?: string };
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error("Manifest needs a nonempty files list");
  const expected = new Map<string, ExpectedClosing>();
  for (const entry of manifest.files) {
    if (!entry.accountId || typeof entry.file !== "string") throw new Error("Each file needs an accountId and file");
    const bytes = new Uint8Array(await readFile(resolve(dirname(manifestPath), entry.file)));
    const file = readBankFile(bytes, entry.layouts);
    if (file.needsLayout) throw new Error("Bank file needs a confirmed layout; include it in this entry's layouts");
    for (const row of statementClosings(file.transactions, entry.accountId, entry.order)) {
      const key = JSON.stringify([row.accountId, row.date]);
      const previous = expected.get(key);
      if (previous && cents(previous.balance) !== cents(row.balance)) {
        throw new Error("Overlapping files disagree on an account/day closing; use complete bank days");
      }
      expected.set(key, row);
    }
  }
  await import("dotenv/config");
  const { prisma } = await import("../src/lib/db.js");
  const { dashboardInputFromRows } = await import("../src/data/queries.js");
  const { readSettings } = await import("../src/data/web-ledger.js");
  try {
    const input = await prisma.$transaction(async (db) => {
      await db.$executeRaw`SET TRANSACTION READ ONLY`;
      const transactions = await db.transaction.findMany({
        include: { category: true, tags: { include: { category: true } } },
        orderBy: [{ bookingDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      });
      const categories = await db.category.findMany({ where: { removed: false } });
      const settings = await readSettings(db);
      const now = manifest.today ? new Date(`${manifest.today}T00:00:00Z`) : new Date();
      return dashboardInputFromRows({ transactions, categories }, now, settings.links, settings.cashEntries);
    }, { isolationLevel: "RepeatableRead" });
    // Fail without printing payment details if anything other than the approved balance fields changes.
    const source = assertBalanceOnlyChanges(input);
    const closings = accountDayClosings(input.transactions);
    const issues = compareClosings(closings, [...expected.values()]);
    const report = {
      nonBalanceParity: true,
      files: manifest.files.length,
      accountDaysChecked: expected.size,
      matched: expected.size - issues.length,
      issues,
      balanceUncertainDays: source.balanceUncertainDays ?? [],
    };
    console.log(JSON.stringify(report, null, 2));
    if (issues.length || report.balanceUncertainDays.length) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.length !== 3) {
    console.error("Usage: npx tsx scripts/check-balances.ts /absolute/path/balance-files.json");
    process.exitCode = 1;
  } else {
    await main(resolve(process.argv[2])).catch(() => {
      console.error("Balance check failed before completion. Check the manifest, bank layouts and database access.");
      process.exitCode = 1;
    });
  }
}
