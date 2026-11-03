// Read-only comparison against brief 223. No payment data is written or printed.
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import type { Prisma } from "@prisma/client";
import { dashboardInputFromRows, type SourceRows } from "../src/data/queries.js";
import { webDashboard } from "../src/data/web-ledger.js";
import { buildDashboardSource } from "../src/engine/source.js";
import { berlinDay } from "../src/data/calendar.js";
import { pulseLine } from "../src/data/pulse.js";
import { MONEY_REVIEW_BASE, moneyReviewModule, type MoneyModule } from "./money-review-module.js";

type DB = Prisma.TransactionClient;
export interface MoneySnapshot extends SourceRows {
  allCategories: SourceRows["categories"];
  settingsRow: Awaited<ReturnType<DB["webSettings"]["findUnique"]>>;
}
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
function equal(actual: unknown, expected: unknown, stage: string) {
  if (!isDeepStrictEqual(json(actual), json(expected))) throw new Error(`Unexpected change in ${stage}`);
}

// Replay one immutable snapshot through each version; neither version can query the live database here.
function replay(snapshot: MoneySnapshot): DB {
  return {
    transaction: { findMany: async () => snapshot.transactions },
    category: { findMany: async (query: { where?: unknown }) =>
      query.where ? snapshot.categories : snapshot.allCategories },
    webSettings: { findUnique: async () => snapshot.settingsRow },
  } as unknown as DB;
}

/** Predict only the two category fixes, using the historical source's already-counted payments. */
export function correctedCategories(
  input: ReturnType<typeof dashboardInputFromRows>,
  source: ReturnType<typeof buildDashboardSource>,
) {
  const net = new Map<string, number>();
  for (const row of source.transactions) {
    const cents = Math.round((row.counted ?? row.amount) * 100);
    net.set(row.categoryName, (net.get(row.categoryName) ?? 0) + cents);
  }
  const categories = input.categories.map((category, index) => ({
    ...source.categories[index],
    kind: category.excludeFromTotals ? "transfer" as const
      : category.side ?? ((net.get(category.name) ?? 0) > 0 ? "income" as const : "spend" as const),
  }));
  // The historical source appends one synthetic category even when that name is already stored.
  const storedNames = new Set(input.categories.map((c) => c.name));
  return categories.concat(source.categories.slice(input.categories.length).filter((c) => !storedNames.has(c.name)));
}

// API field names only: no category names, ids, payment text or amounts in the report.
function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !isDeepStrictEqual(json(before[key] ?? null), json(after[key] ?? null)));
}

export async function compareMoneySnapshot(old: MoneyModule, snapshot: MoneySnapshot, now: Date) {
  const db = replay(snapshot);
  const settings = await old.readSettings(db);
  const oldInput = old.dashboardInputFromRows(snapshot, now, settings.links, settings.cashEntries);
  const input = dashboardInputFromRows(snapshot, now, settings.links, settings.cashEntries);
  equal(input, { ...oldInput, today: berlinDay(now) }, "server input");

  // Normalize only the calendar day, then correct the categories. Every other source value must match.
  const oldSource = old.buildDashboardSource({ ...oldInput, today: berlinDay(now) });
  const expectedSource = { ...oldSource, categories: correctedCategories(input, oldSource) };
  const source = buildDashboardSource(input);
  equal(source, expectedSource, "dashboard source");

  const before = await old.webDashboard(db, now);
  const after = await webDashboard(db, now);
  const order = snapshot.transactions.slice().sort((a, b) =>
    a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const sequence = new Map(order.map((p, index) => [p.id, index]));
  const info = [
    ...snapshot.transactions.map((p) => ({
      id: p.id, counterparty: p.counterparty, description: p.description, amount: Number(p.amount),
      currency: p.currency, categorySource: p.categorySource, sequence: sequence.get(p.id),
    })),
    ...settings.cashEntries.map((p, index) => ({
      id: p.id, counterparty: p.shop, description: p.shop || "", amount: p.direction === "in" ? p.total : -p.total,
      currency: "EUR", categorySource: "receipt", sequence: snapshot.transactions.length + index,
    })),
  ];
  // The entire old counting/ledger code remains the oracle after just those source corrections.
  const expectedLedger = old.buildLedgerDashboard(expectedSource, info, settings, berlinDay(now));
  const expected = {
    ...before,
    ...expectedLedger,
    categoryOptions: before.categoryOptions.map((c) => ({
      ...c,
      kind: c.excludeFromTotals ? "transfer"
        : c.side ?? expectedSource.categories.find((category) => category.name === c.name)?.kind ?? "spend",
    })),
  };
  equal(after, expected, "dashboard (including every balance, total, chart, list and fixed cost)");
  // At Berlin noon the old host-local pulse picks the same month in the server's UTC/Berlin timezones.
  // Derive its expected string using the calendar components directly, independent of the host timezone.
  const day = berlinDay(now);
  const localNoon = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8)), 12);
  for (const language of ["en", "de"] as const) {
    equal(pulseLine(after, now, language), old.pulseLine(expected, localNoon, language), "pulse");
  }
  return {
    baseline: MONEY_REVIEW_BASE,
    asOf: day,
    paymentsChecked: input.transactions.length,
    onlyIntendedChanges: true,
    changedDashboardFields: changedFields(before, after),
  };
}

async function main() {
  await import("dotenv/config");
  const baseline = await moneyReviewModule();
  const { prisma } = await import("../src/lib/db.js");
  try {
    const snapshot = await prisma.$transaction(async (db): Promise<MoneySnapshot> => {
      await db.$executeRaw`SET TRANSACTION READ ONLY`;
      return {
        transactions: await db.transaction.findMany({
          include: { category: true, tags: { include: { category: true } } },
          orderBy: [{ bookingDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        }),
        categories: await db.category.findMany({ where: { removed: false } }),
        allCategories: await db.category.findMany({ orderBy: { name: "asc" } }),
        settingsRow: await db.webSettings.findUnique({ where: { id: "owner" } }),
      };
    }, { isolationLevel: "RepeatableRead" });
    console.log(JSON.stringify(await compareMoneySnapshot(
      baseline.module, snapshot, new Date("2026-11-03T12:00:00Z")), null, 2));
  } finally {
    await prisma.$disconnect();
    await baseline.close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main().catch(() => {
    console.error("Money review failed: unexpected changes, missing baseline commit, or database/build failure.");
    process.exitCode = 1;
  });
}
