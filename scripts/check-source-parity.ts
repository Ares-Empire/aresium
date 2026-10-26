// Same results before deleting (AGENTS.md): computes the dashboard source the old way (getDashboardSourceLegacy) and
// through the engine (getDashboardSource's path) from the same database rows, plus the dashboard built from each and
// the PayPal codes each would warn about, and compares them value by value. Reads the database only (two findMany).
// Prints one line: "identical (N payments compared)", or the number of differing keys per part. Never a value, a
// name or a payment id.
//
// Run on the server: npx tsx scripts/check-source-parity.ts
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { buildDashboard } from "../src/data/dashboard.js";
import { dashboardSourceFromRows, fetchSourceRows, getDashboardSourceLegacy } from "../src/data/queries.js";
import { prisma } from "../src/lib/db.js";

export type Parity = { differing: number; parts: Record<string, number>; sameOrder: boolean };

const EMPTY_ARRAY = Symbol("[]");
const EMPTY_OBJECT = Symbol("{}");

// Every leaf of a JSON-like value by its path. Empty arrays and objects count as leaves, so [] ≠ {} ≠ missing.
function leaves(value: unknown, path: string[] = [], out = new Map<string, unknown>()): Map<string, unknown> {
  if (value !== null && typeof value === "object") {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
    if (entries.length === 0) out.set(JSON.stringify(path), Array.isArray(value) ? EMPTY_ARRAY : EMPTY_OBJECT);
    for (const [key, child] of entries) leaves(child, [...path, key], out);
  } else {
    out.set(JSON.stringify(path), value);
  }
  return out;
}

// The part a key belongs to: its first field, and the second when that is a field name ("source.transactions",
// "dashboard.byMonth", "unmatched"). These are the code's field names, never data.
function part(key: string): string {
  const path = JSON.parse(key) as string[];
  return path.length > 1 && !/^\d+$/.test(path[1]) ? `${path[0]}.${path[1]}` : path[0] ?? "";
}

/** Compare two values leaf by leaf (Object.is), and whether they also serialise in the same key order. */
export function compare(a: unknown, b: unknown): Parity {
  const left = leaves(a), right = leaves(b);
  const parts: Record<string, number> = {};
  let differing = 0;
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    if (left.has(key) && right.has(key) && Object.is(left.get(key), right.get(key))) continue;
    differing++;
    parts[part(key)] = (parts[part(key)] ?? 0) + 1;
  }
  return { differing, parts, sameOrder: JSON.stringify(a) === JSON.stringify(b) };
}

/** The line the check prints: counts only. */
export function report({ differing, parts, sameOrder }: Parity, payments: number): string {
  if (differing === 0 && sameOrder) return `identical (${payments} payments compared)`;
  if (differing === 0) return "same values, different key order";
  return `${differing} differing keys (${Object.entries(parts).map(([name, n]) => `${name}: ${n}`).join(", ")})`;
}

export async function checkSourceParity(now = new Date()): Promise<string> {
  const rows = await fetchSourceRows();
  const legacy = getDashboardSourceLegacy(rows, now);
  const engine = dashboardSourceFromRows(rows, now);
  const result = compare(
    { source: legacy.source, dashboard: buildDashboard(legacy.source), unmatched: legacy.unmatched },
    { source: engine.source, dashboard: buildDashboard(engine.source), unmatched: engine.unmatched },
  );
  return report(result, rows.transactions.length);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    console.log(await checkSourceParity());
  } finally {
    await prisma.$disconnect();
  }
}
