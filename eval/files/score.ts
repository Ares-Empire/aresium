import { appendFile, mkdir, open, readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createContext, runInContext } from "node:vm";
import { readBankFile } from "../../src/engine/readers/read.js";
import type { BankFile, BankTxn, CsvLayout } from "../../src/engine/readers/types.js";
import { cents, type FileCase, type Payment } from "./types.js";

export type Reader = (bytes: ArrayLike<number>, savedLayouts?: readonly CsvLayout[]) => BankFile;
type ActualPayment = Omit<Payment, "amountCents"> & { amountCents: number | string };
type Difference = { expected?: Payment; actual?: ActualPayment; fields: string[] };
export type CaseResult = {
  file: string;
  bank: string;
  kind: string;
  status: "right" | "refusedExpected" | "refusedUnexpected" | "wrong";
  review: boolean;
  wrongRows: number;
  differences: Difference[];
  problems: string[];
  reimport?: { kept: boolean; matched: number; total: number };
};

const keys = ["date", "amountCents", "currency", "counterparty", "text"] as const;
const signature = (p: ActualPayment) => JSON.stringify(keys.map((k) => p[k]));
const payment = (t: BankTxn): ActualPayment => ({
  date: t.bookingDate.slice(0, 10),
  amountCents: cents(t.amount) ?? `invalid cents: ${t.amount}`,
  currency: t.currency,
  counterparty: t.counterparty ?? null,
  text: t.description,
});

// Match equal payments first, including duplicate occurrences, so one missing payment does not shift every
// later row. Pair remaining payments by their closest fields. One changed payment counts once, however many
// fields differ; each remaining missing/extra payment counts once. Order itself is not part of the contract.
export function comparePayments(expected: Payment[], actual: ActualPayment[]): Difference[] {
  const remaining = actual.map((p) => ({ p, key: signature(p) }));
  const missing: Payment[] = [];
  for (const p of expected) {
    const i = remaining.findIndex((a) => a.key === signature(p));
    if (i >= 0) remaining.splice(i, 1);
    else missing.push(p);
  }
  const differences: Difference[] = [];
  while (missing.length && remaining.length) {
    let best = { e: 0, a: 0, fields: [...keys] as string[] };
    for (let e = 0; e < missing.length; e++) for (let a = 0; a < remaining.length; a++) {
      const fields = keys.filter((k) => missing[e][k] !== remaining[a].p[k]);
      if (fields.length < best.fields.length) best = { e, a, fields };
    }
    differences.push({ expected: missing.splice(best.e, 1)[0], actual: remaining.splice(best.a, 1)[0].p, fields: best.fields });
  }
  differences.push(...missing.map((p) => ({ expected: p, fields: ["missing payment"] })));
  differences.push(...remaining.map(({ p }) => ({ actual: p, fields: ["extra payment"] })));
  return differences;
}

function matchingIds(original: string[], actual: string[]): number {
  const left = [...actual];
  let matched = 0;
  for (const id of original) {
    const i = left.indexOf(id);
    if (i >= 0) { matched++; left.splice(i, 1); }
  }
  return matched;
}

export function scoreCase(spec: FileCase, bytes: ArrayLike<number>, reader: Reader): CaseResult {
  const result: CaseResult = { file: spec.file, bank: spec.bank, kind: spec.kind, status: "right", review: false,
    wrongRows: 0, differences: [], problems: [] };
  if (spec.reimport) result.reimport = { kept: false, matched: 0, total: spec.reimport.originalIds.length };
  let file: BankFile;
  try {
    file = reader(bytes);
    if (file.needsLayout) {
      result.review = true;
      if (!file.needsLayout.layout) {
        result.status = "refusedUnexpected";
        result.problems.push("Layout confirmation needed, but no complete first guess was offered (not a coded refusal).");
        return result;
      }
      // No oracle-selected layout: measure exactly the first guess the user would see and could confirm.
      file = reader(bytes, [file.needsLayout.layout]);
      if (file.needsLayout) throw new Error("The first guessed layout did not read the file when confirmed.");
    }
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    result.status = spec.expected.outcome === "refuse" && typeof code === "string" && code === spec.expected.code
      ? "refusedExpected" : "refusedUnexpected";
    if (result.status === "refusedUnexpected") {
      result.problems.push(`Refused with ${typeof code === "string" ? code : "uncoded exception"}: ${(error as Error).message}; expected ${spec.expected.outcome === "refuse" ? spec.expected.code : "payments"}.`);
    }
    return result;
  }
  if (spec.reimport) {
    const ids = file.transactions.map((t) => t.externalId);
    const matched = matchingIds(spec.reimport.originalIds, ids);
    // Equal id sets alone would miss ids swapped between two payments. Associate each id with its original
    // payment; allow reordered rows and repeated identical payments, but require the same multiset of pairs.
    const originalPairs = spec.expected.outcome === "read" ? spec.expected.payments.map((p, i) =>
      JSON.stringify([signature(p), spec.reimport!.originalIds[i]])) : [];
    const actualPairs = file.transactions.map((t) => JSON.stringify([signature(payment(t)), t.externalId]));
    const pairsKept = matchingIds(originalPairs, actualPairs);
    result.reimport = { kept: pairsKept === actualPairs.length && pairsKept === originalPairs.length,
      matched, total: spec.reimport.originalIds.length };
    if (!result.reimport.kept) result.problems.push(`Re-import ids kept: ${matched}/${spec.reimport.originalIds.length} original id values present (${ids.length} returned); payment/id associations differ.`);
  }
  const actual = file.transactions.map(payment);
  if (spec.expected.outcome === "refuse") {
    result.status = "wrong";
    result.differences = actual.map((p) => ({ actual: p, fields: ["extra payment in a file that must be refused"] }));
    result.problems.push(`Expected refusal ${spec.expected.code}; returned ${actual.length} payments.`);
  } else {
    result.differences = comparePayments(spec.expected.payments, actual);
    if (result.differences.length) result.status = "wrong";
    if (spec.expected.warning && file.skipped !== spec.expected.warning.skipped) {
      result.status = "wrong";
      result.problems.push(`Expected skipped-row warning ${spec.expected.warning.skipped}; got ${file.skipped ?? "none"}.`);
    }
  }
  result.wrongRows = result.differences.length;
  return result;
}

export function summarize(results: CaseResult[]) {
  return {
    files: results.length,
    readRight: results.filter((r) => r.status === "right").length,
    refusedExpected: results.filter((r) => r.status === "refusedExpected").length,
    refusedUnexpected: results.filter((r) => r.status === "refusedUnexpected").length,
    readWrong: results.filter((r) => r.status === "wrong").length,
    wrongRowsWithoutError: results.reduce((n, r) => n + r.wrongRows, 0),
    // A review gate is visible to the user. Keep these distinct from automatic, silently wrong readings.
    silentlyWrongRows: results.filter((r) => !r.review).reduce((n, r) => n + r.wrongRows, 0),
    reviewWrongRows: results.filter((r) => r.review).reduce((n, r) => n + r.wrongRows, 0),
    reviewFiles: results.filter((r) => r.review).length,
    reimportKept: results.filter((r) => r.reimport?.kept).length,
    reimportTotal: results.filter((r) => r.reimport).length,
    idsKept: results.reduce((n, r) => n + (r.reimport?.matched ?? 0), 0),
    idsTotal: results.reduce((n, r) => n + (r.reimport?.total ?? 0), 0),
  };
}

export function formatReport(results: CaseResult[]): string {
  const s = summarize(results);
  const lines = [
    `Files: ${s.files}; read right: ${s.readRight}; refused as expected: ${s.refusedExpected}; refused unexpectedly: ${s.refusedUnexpected}; READ WRONG: ${s.readWrong}`,
    `Rows silently wrong (automatic reads): ${s.silentlyWrongRows}`,
    `Rows wrong behind layout confirmation: ${s.reviewWrongRows}; files needing confirmation: ${s.reviewFiles}`,
    `Total wrong rows in non-error readings: ${s.wrongRowsWithoutError}`,
    `Re-import ids kept: ${s.reimportKept} of ${s.reimportTotal} files; ${s.idsKept} of ${s.idsTotal} original id values present`,
  ];
  for (const group of ["kind", "bank"] as const) {
    lines.push("", `By ${group}:`, "| " + group + " | files | right | refused OK | refused unexpected | wrong | silent rows | review rows | ids kept/files |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const label of [...new Set(results.map((r) => r[group]))].sort()) {
      const c = summarize(results.filter((r) => r[group] === label));
      lines.push(`| ${label} | ${c.files} | ${c.readRight} | ${c.refusedExpected} | ${c.refusedUnexpected} | ${c.readWrong} | ${c.silentlyWrongRows} | ${c.reviewWrongRows} | ${c.reimportKept}/${c.reimportTotal} |`);
    }
  }
  lines.push("", "Failing files (at most three payment differences per file; text clipped to 160 characters):");
  const clip = (p: ActualPayment | undefined) => p ? JSON.stringify({ ...p,
    counterparty: p.counterparty?.slice(0, 160) ?? null, text: p.text.slice(0, 160) }) : "absent";
  for (const r of results.filter((r) => r.status === "wrong" || r.status === "refusedUnexpected" || r.reimport?.kept === false)) {
    lines.push(`${r.file}: ${r.status}${r.review ? " (layout confirmation)" : ""}`);
    lines.push(...r.problems.map((p) => `  ${p}`));
    for (const d of r.differences.slice(0, 3)) lines.push(`  ${d.fields.join(", ")}: expected ${clip(d.expected)}; got ${clip(d.actual)}`);
    if (r.differences.length > 3) lines.push(`  ... ${r.differences.length - 3} more differences`);
  }
  return lines.join("\n");
}

// Shared, suite-neutral CSV format: brief 79 can put its headline metrics in the same JSON cell.
export const HISTORY_HEADER = "date,commit,suite,metrics\n";
export async function recordHistory(path: string, commit: string, metrics: ReturnType<typeof summarize>, date = new Date().toISOString()) {
  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(path, "ax");
    try { await handle.writeFile(HISTORY_HEADER); } finally { await handle.close(); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const existing = await readFile(path, "utf8");
  // The sorting suite widens the header with its own columns after these four; a files row fills the first four.
  if (!existing.startsWith(HISTORY_HEADER.trim()) || !existing.endsWith("\n")) throw new Error(`Unexpected history format in ${path}; expected ${HISTORY_HEADER.trim()}.`);
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  await appendFile(path, [date, commit, "files", JSON.stringify(metrics)].map(cell).join(",") + "\n");
}

export async function loadReader(path?: string): Promise<Reader> {
  if (!path) return readBankFile;
  const context = createContext({});
  runInContext(await readFile(resolve(path), "utf8"), context);
  const engine = context.AresiumEngine as { readBankFile?: Reader } | undefined;
  if (typeof engine?.readBankFile !== "function") throw new Error("Bundle does not expose AresiumEngine.readBankFile.");
  return engine.readBankFile;
}

export async function runCases(folder: string, reader: Reader): Promise<CaseResult[]> {
  const names = (await readdir(folder)).filter((n) => n.endsWith(".case.json")).sort();
  if (!names.length) throw new Error("No file cases found. Run npx tsx eval/files/make.ts first.");
  const results: CaseResult[] = [];
  for (const name of names) {
    const spec = JSON.parse(await readFile(resolve(folder, name), "utf8")) as FileCase;
    if (spec.version !== 1 || !spec.file || /[/\\]/.test(spec.file) || !spec.kind || !spec.bank ||
        !["read", "refuse"].includes(spec.expected?.outcome)) throw new Error(`Invalid case manifest: ${name}`);
    if (spec.expected.outcome === "read" && (!Array.isArray(spec.expected.payments) || spec.expected.payments.some((p) =>
      !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !Number.isSafeInteger(p.amountCents) || typeof p.text !== "string" ||
      typeof p.currency !== "string" || (p.counterparty !== null && typeof p.counterparty !== "string")))) throw new Error(`Invalid payments: ${name}`);
    if (spec.expected.outcome === "refuse" && !spec.expected.code) throw new Error(`Missing refusal code: ${name}`);
    if (spec.reimport && (spec.expected.outcome !== "read" || !Array.isArray(spec.reimport.originalIds) ||
        spec.reimport.originalIds.length !== spec.expected.payments.length || spec.reimport.originalIds.some((id) => typeof id !== "string"))) {
      throw new Error(`Invalid original ids: ${name}`);
    }
    results.push(scoreCase(spec, new Uint8Array(await readFile(resolve(folder, spec.file))), reader));
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  let engine: string | undefined, record = false, json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--engine" && args[i + 1] && !args[i + 1].startsWith("--")) engine = args[++i];
    else if (args[i] === "--record") record = true;
    else if (args[i] === "--json") json = true;
    else throw new Error("Usage: npm run eval:files -- [--engine <bundle>] [--record] [--json]");
  }
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const results = await runCases(resolve(root, "eval/files/cases"), await loadReader(engine));
  console.log(formatReport(results));
  if (json) {
    const output = resolve(root, "eval/files/out");
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, "latest.json"), JSON.stringify({ engine: engine ?? "source", summary: summarize(results), results }, null, 2) + "\n");
  }
  if (record) {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root, encoding: "utf8" }).trim();
    await recordHistory(resolve(root, "eval/history.csv"), commit + (dirty ? "-dirty" : ""), summarize(results));
    console.log("Recorded headline metrics in eval/history.csv.");
  }
  // This is a measurement, not a zero-failure CI assertion. Invalid input or harness failures still exit 1.
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main().catch((error) => { console.error(error); process.exitCode = 1; });
}
