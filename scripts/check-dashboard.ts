import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { createContext, runInContext } from "node:vm";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { buildDashboard, type DashboardSource } from "../src/data/dashboard.js";
import { buildSampleSource } from "../src/data/sample-source.js";

type Interface = Record<string, any>;

async function loadAdapter(path: string, payload: unknown, legacy: boolean) {
  const window: Interface = legacy ? { AresiumMockSource: structuredClone(payload) } : { AresiumSample: structuredClone(payload) };
  const context = createContext({
    location: { protocol: "file:" }, // the offline path: data.js reads window.AresiumSample
    window,
    // Initial loading deliberately exercises the offline fallback. refresh uses fetch.
    fetch: async () => ({ ok: true, json: async () => structuredClone(payload) }),
  });
  runInContext(await readFile(new URL(path, import.meta.url), "utf8"), context);
  return window.AresiumData as Interface;
}

export async function checkDashboard(source: DashboardSource) {
  const start = performance.now();
  const dashboard = buildDashboard(source);
  const buildMs = performance.now() - start;
  const old = await loadAdapter("./legacy/data-v1.js", source, true);
  const next = await loadAdapter("../web/public/app/data.js", dashboard, false);
  const monthKeys = source.months.map((m) => m.key);
  const categoryNames = source.categories.map((c) => c.name);
  const bucketNames = dashboard.incomeBuckets.map((c) => c.name);
  // Include absent names and built-in fallbacks, as well as names that actually occur.
  const cats = [...new Set([...categoryNames, ...source.transactions.flatMap((t) => [t.categoryName, ...(t.tags || [])]), "Unknown category"])];
  const buckets = [...new Set([...bucketNames, ...categoryNames, "Refunds", "Other", "Unknown bucket"])];
  const months = monthKeys.map((k) => [k]);
  const optionalMonths = [...months, [null], [undefined], [""]];
  const product = (names: string[]) => names.flatMap((name) => monthKeys.map((key) => [name, key]));
  const calls: Record<string, any[][]> = {
    monthExpense: [...months, [null]], monthEndBalance: [...months, [null]],
    dayExpenseSeries: months, dayBalanceSeries: months,
    categoryMonthSeries: cats.map((c) => [c]), categoryDaySeries: product(cats),
    categoryTotalsAll: [[]], categoryTotalsMonth: [...months, [null]],
    expenseTotal: optionalMonths, incomeTotalPrimary: optionalMonths,
    categoryMonthList: cats.map((c) => [c]),
    categoryMonthTransactions: [...product(cats), ...cats.map((c) => [c, null])],
    incomeBucketOf: [
      ...source.transactions.map((t) => [t]),
      ...[...cats, "Uncategorised", "Tax", "", undefined].map((categoryName) => [{ categoryName }]),
    ],
    incomeBucketMeta: buckets.map((b) => [b]), incomeDaySeries: months,
    incomeTotalsAll: [[]], incomeTotalsMonth: optionalMonths,
    incomeBucketMonthSeries: buckets.map((b) => [b]), incomeBucketDaySeries: product(buckets),
    incomeBucketMonthList: buckets.map((b) => [b]),
    incomeBucketMonthTransactions: [...product(buckets), ...buckets.map((b) => [b, null])],
    refresh: [[]],
  };
  let compared = 0;
  let mismatches = 0;
  const firstMismatches: string[] = [];
  const compare = (label: string, a: unknown, b: unknown) => {
    compared++;
    // Move VM values into this realm without JSON's loss of undefined or negative zero.
    if (!isDeepStrictEqual(structuredClone(a), structuredClone(b))) {
      mismatches++;
      if (firstMismatches.length < 20) firstMismatches.push(label);
    }
  };
  // openingBalance and balanceByDay are excluded because no UI file reads either key.
  // `pick` is new in version 2 (it replaced logic in panels.jsx) and is compared separately below.
  const interfaceKeys = (data: Interface) => Object.keys(data).filter((key) => key !== "openingBalance" && key !== "balanceByDay" && key !== "pick");
  compare("interface keys", interfaceKeys(old).sort(), interfaceKeys(next).sort());
  for (const key of interfaceKeys(old)) {
    if (typeof old[key] !== "function") { compare(key, old[key], next[key]); continue; }
    if (!calls[key]) throw new Error(`Missing argument coverage for ${key}`);
    for (const [i, args] of calls[key].entries()) {
      const a = await old[key](...structuredClone(args));
      const b = await next[key](...structuredClone(args));
      compare(`${key} argument set ${i + 1}`, a, b);
    }
  }
  // Recategorise choices: the old panels.jsx code (verbatim, on the old interface) vs the server's `pick`.
  for (const isIncomeItem of [false, true]) {
    const allCats = old.categories || [];
    const incomeKeep = new Set(["Tax"]);
    allCats.forEach((c: any) => { if (c.kind === "income" || c.kind === "transfer") incomeKeep.add(c.name); });
    const orderNames = (isIncomeItem ? old.incomeTotalsAll() : old.categoryTotalsAll()).map((r: any) => r.name);
    const oldList = allCats.filter((c: any) => (isIncomeItem ? incomeKeep.has(c.name) : c.kind === "spend"))
      .slice().sort((a: any, b: any) => {
        const ia = orderNames.indexOf(a.name), ib = orderNames.indexOf(b.name);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1; if (ib !== -1) return 1;
        return a.name.localeCompare(b.name);
      });
    const newList = (isIncomeItem ? next.pick.income : next.pick.spend).map((n: string) => next.catByName[n]).filter(Boolean);
    compare(`pick ${isIncomeItem ? "income" : "spend"}`, oldList, newList);
  }
  // Refresh must update the original object, and preserve the complete interface.
  compare("keys after refresh", interfaceKeys(old).sort(), interfaceKeys(next).sort());
  for (const key of interfaceKeys(old)) if (typeof old[key] !== "function") compare(`after refresh: ${key}`, old[key], next[key]);
  return {
    compared, mismatches, firstMismatches, buildMs,
    v1Bytes: Buffer.byteLength(JSON.stringify(source)), v2Bytes: Buffer.byteLength(JSON.stringify(dashboard)),
  };
}

async function main() {
  const mode = process.argv.slice(2);
  if (mode.length !== 1 || !["--sample", "--db"].includes(mode[0])) {
    throw new Error("Usage: tsx scripts/check-dashboard.ts --sample | --db");
  }
  // Sample mode never imports Prisma, dotenv or anything that needs a database.
  const queries = mode[0] === "--db" ? await import("../src/data/queries.js") : undefined;
  try {
    const source = queries ? await queries.getDashboardSource() : buildSampleSource();
    const result = await checkDashboard(source);
    console.log(`Compared ${result.compared} values; ${result.mismatches} mismatches`);
    for (const label of result.firstMismatches) console.log(`Mismatch: ${label}`);
    console.log(`buildDashboard: ${result.buildMs.toFixed(3)} ms`);
    console.log(`JSON size: version 1 ${result.v1Bytes} bytes; version 2 ${result.v2Bytes} bytes`);
    if (result.mismatches) process.exitCode = 1;
  } finally {
    if (queries) { const { prisma } = await import("../src/lib/db.js"); await prisma.$disconnect(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: Error) => { console.error(err.message); process.exitCode = 1; });
}
