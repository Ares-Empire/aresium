import { appendFile, open, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { DEFAULT_CATEGORIES } from "../../src/engine/categories.js";
import { splitCsv } from "../../src/engine/readers/csv.js";
import { sortPayments } from "../../src/engine/sorting/sort.js";
import { ROOT, heldback, loadCases, initialLabel, fingerprint, readLines, type EvalCase, type Label } from "./model.js";
import { batches, merge } from "./judge.js";
export type Sorter = typeof sortPayments;
export type Counts = { total: number; disputed: number; sorted: number; right: number; wrong: number; missed: number; unsortedRight: number };
export type Outcome = "right" | "wrong" | "missed" | "unsortedRight" | "disputed";
export function outcome(label: Label, category: string | null): Outcome {
  if (label.disputed) return "disputed";
  if (category !== null) return label.accepted.includes(category) ? "right" : "wrong";
  return label.unsortedRight ? "unsortedRight" : "missed";
}
export function count(rows: { label: Label; category: string | null }[]): Counts {
  const result: Counts = { total: 0, disputed: 0, sorted: 0, right: 0, wrong: 0, missed: 0, unsortedRight: 0 };
  for (const { label, category } of rows) {
    const status = outcome(label, category);
    if (status === "disputed") { result.disputed++; continue; }
    result.total++; result.sorted += Number(category !== null); result[status]++;
  }
  return result;
}
export function predict(cases: EvalCase[], sorter: Sorter = sortPayments): Map<string, string | null> {
  const result = new Map<string, string | null>();
  const groups = new Map<string, EvalCase[]>();
  const plain = cases.filter((c) => !c.group);
  // One fresh-person call for ordinary cases; every scenario has its own independent context.
  const sort = (rows: EvalCase[]) => {
    let predictions;
    try { predictions = sorter(rows.map((c) => c.payment), { categories: DEFAULT_CATEGORIES, learned: {} }); }
    catch { throw new Error("Engine sorting failed; payment details withheld"); }
    if (!Array.isArray(predictions) || predictions.some((p) => !p || !(p.categoryId === null || typeof p.categoryId === "string")) || predictions.length !== rows.length) throw new Error("Engine returned wrong number of predictions");
    rows.forEach((c, i) => result.set(c.id, predictions[i].categoryId));
  };
  sort(plain);
  for (const c of cases) if (c.group) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  for (const rows of groups.values()) sort(rows);
  return result;
}
export async function loadSorter(path?: string): Promise<Sorter> {
  if (!path) return sortPayments;
  const code = await readFile(resolve(path), "utf8"), context = createContext({});
  runInContext(code, context, { timeout: 10_000 });
  const engine = context.AresiumEngine as { sortPayments?: Sorter };
  if (typeof engine?.sortPayments !== "function") throw new Error("Bundle does not expose AresiumEngine.sortPayments");
  return engine.sortPayments;
}
export async function loadLabels(cases: EvalCase[]): Promise<{ labels: Map<string, Label>; judged: boolean }> {
  const files = [new URL("labels.jsonl", ROOT), new URL("labels.heldback.jsonl", ROOT)];
  const exists = await Promise.all(files.map(async (file) => { try { await stat(file); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; } }));
  if (!exists.some(Boolean)) return { labels: new Map(cases.map((c) => [c.id, initialLabel(c)])), judged: false };
  if (!exists.every(Boolean)) throw new Error("Both label partitions are required; rerun --merge");
  const labels = (await Promise.all(files.map((file) => readLines<Label>(file)))).flat(), byId = new Map(labels.map((l) => [l.id, l]));
  if (byId.size !== cases.length || byId.size !== labels.length || cases.some((c) => byId.get(c.id)?.fingerprint !== fingerprint(c))) throw new Error("Missing, duplicate or stale labels; rejudge changed cases");
  const bases = new Set(labels.map((l) => l.basis));
  if (bases.size !== 1 || !["generator", "majority"].includes(labels[0]?.basis)) throw new Error("Inconsistent label basis; regenerate or merge all labels");
  return { labels: byId, judged: labels[0].basis === "majority" };
}
const format = (counts: Counts) => Object.values(counts).join("\t");
const columns = "total\tdisputed\tsorted\tright\twrong\tmissed\tunsorted-right";
export function report(cases: EvalCase[], labels: Map<string, Label>, predictions: Map<string, string | null>): { text: string; worked: Counts; held: Counts } {
  const scored = (rows: EvalCase[]) => count(rows.map((c) => ({ label: labels.get(c.id)!, category: predictions.get(c.id)! })));
  const lines: string[] = [];
  const partitions = [cases.filter((c) => !heldback(c.id)), cases.filter((c) => heldback(c.id))];
  for (const [index, part] of partitions.entries()) {
    lines.push(`\n${index ? "Held back (aggregate counts only)" : "Worked on"}`, `group\t${columns}`, `ALL\t${format(scored(part))}`);
    const groups = new Map<string, EvalCase[]>();
    for (const c of part) for (const key of [c.kind, ...(c.kind === "brand" ? [`brand-${c.inShopList ? "known" : "unknown"}`] : []), (c.payment.amount ?? 0) > 0 ? "money-in" : "money-out", `service:${c.rendering.service}`]) groups.set(key, [...(groups.get(key) ?? []), c]);
    if (!index) for (const c of part) for (const cat of labels.get(c.id)!.accepted.length ? labels.get(c.id)!.accepted : ["unsorted-accepted"]) groups.set(`category:${cat}`, [...(groups.get(`category:${cat}`) ?? []), c]);
    for (const [group, rows] of [...groups].sort(([a], [b]) => a.localeCompare(b))) lines.push(`${group}\t${format(scored(rows))}`);
    const scenarios = new Map<string, EvalCase[]>();
    for (const c of part) if (c.group) scenarios.set(c.group, [...(scenarios.get(c.group) ?? []), c]);
    const scenarioCounts = { total: 0, right: 0, wrong: 0, missed: 0, disputed: 0 };
    for (const rows of scenarios.values()) {
      const statuses = rows.map((c) => outcome(labels.get(c.id)!, predictions.get(c.id)!));
      if (statuses.includes("disputed")) scenarioCounts.disputed++;
      else { scenarioCounts.total++; if (statuses.includes("wrong")) scenarioCounts.wrong++;
        else if (statuses.includes("missed")) scenarioCounts.missed++; else scenarioCounts.right++; }
    }
    lines.push(`Scenario groups (all sides must be right): ${JSON.stringify(scenarioCounts)}`);
  }
  lines.push("\nWorked-on wrong and missed payments:");
  for (const c of partitions[0]) {
    const label = labels.get(c.id)!, category = predictions.get(c.id)!, status = outcome(label, category);
    if (status === "wrong" || status === "missed") lines.push(JSON.stringify({ id: c.id, status, line: c.rendering.line, engine: category, accepted: label.accepted, unsortedRight: label.unsortedRight }));
  }
  return { text: lines.join("\n"), worked: scored(partitions[0]), held: scored(partitions[1]) };
}
export async function record(worked: Counts, held: Counts, file = new URL("../history.csv", ROOT)): Promise<void> {
  const columns = ["date", "commit", "suite", ...["worked", "heldback"].flatMap((part) => ["total", "disputed", "sorted", "right", "wrong", "missed", "unsortedRight"].map((key) => `${part}_${key}`))];
  await mkdir(new URL("./", file), { recursive: true });
  const lockPath = new URL(file.href + ".lock");
  let lock;
  for (let i = 0; i < 50; i++) { try { lock = await open(lockPath, "wx"); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; await new Promise((r) => setTimeout(r, 100)); } }
  if (!lock) throw new Error("History is locked; retry after the other evaluator finishes");
  try {
    let existing = "";
    try { existing = await readFile(file, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const rows = existing ? splitCsv(existing, ",").filter((row) => row.some((cell) => cell !== "")) : [];
    const oldHeader = rows[0] ?? [];
    if (new Set(oldHeader).size !== oldHeader.length || rows.slice(1).some((row) => row.length !== oldHeader.length)) throw new Error("Invalid shared history CSV; no history was changed");
    const combined = [...oldHeader, ...columns.filter((key) => !oldHeader.includes(key))];
    const csv = (row: string[]) => row.map((cell) => /[,"\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell).join(",") + "\n";
    if (!existing || combined.length !== oldHeader.length) {
      // Keep brief 78's columns and rows when either evaluator creates the shared file first.
      await writeFile(file, csv(combined) + rows.slice(1).map((row) => csv([...row, ...new Array<string>(combined.length - oldHeader.length).fill("")])).join(""));
    }
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: new URL("../../", ROOT), encoding: "utf8" }).trim();
    const values = [new Date().toISOString(), commit, "sorting", ...Object.values(worked), ...Object.values(held)].map(String);
    const fields = new Map(columns.map((key, i) => [key, values[i]]));
    await appendFile(file, csv(combined.map((key) => fields.get(key) ?? "")));
  } finally { await lock.close(); const { unlink } = await import("node:fs/promises"); await unlink(lockPath); }
}
export async function main(args = process.argv.slice(2)): Promise<void> {
  const cases = await loadCases();
  if (args.includes("--batches")) { await batches(cases); return; }
  if (args.includes("--merge")) {
    const paths = args.slice(args.indexOf("--merge") + 1);
    if (paths.length !== 2) throw new Error("Use --merge <judge-1.jsonl> <judge-2.jsonl>");
    await merge(cases, paths[0], paths[1]); return;
  }
  const engineIndex = args.indexOf("--engine");
  if (engineIndex >= 0 && (!args[engineIndex + 1] || args[engineIndex + 1].startsWith("--"))) throw new Error("--engine requires a bundle path");
  if (args.some((arg, i) => !["--record", "--engine"].includes(arg) && !(engineIndex >= 0 && i === engineIndex + 1))) throw new Error("Unknown evaluation argument");
  const { labels, judged } = await loadLabels(cases);
  console.log(judged ? "Labels: majority of generator and two independent judges" : "PROVISIONAL: scoring against generator first answers alone; independent judging has not run.");
  const predictions = predict(cases, await loadSorter(engineIndex >= 0 ? args[engineIndex + 1] : undefined));
  const result = report(cases, labels, predictions);
  console.log(result.text);
  if (args.includes("--record")) await record(result.worked, result.held);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { await main(); } catch (e) { console.error((e as Error).message); process.exitCode = 1; }
}
