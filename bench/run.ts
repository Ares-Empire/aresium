import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { DEFAULT_CATEGORIES, BUILT_IN_CATEGORIES } from "../src/engine/categories.js";
import { learn, sortPayments, type Learned } from "../src/engine/sorting/sort.js";
import { starterCategory } from "../src/engine/sorting/starter-rules.js";
import { autoSort, DEFAULT_MODEL, type BatchMetrics, type GroqOptions } from "../src/sort/groq.js";
import { CATEGORY_MAP, DATA_FILE, RESULTS_FILE, parseData, type BenchPayment } from "./data.js";
import { PRICE_DATE, PRICE_SOURCE, PRICES } from "./prices.js";

// `structural` maps the engine's built-in category (own transfers) into the scenario's list.
type Scenario = {
  title: string; categories: { id: string; name: string }[]; acceptable: (p: BenchPayment) => readonly string[];
  starter: (p: BenchPayment) => string | null; structural: (id: string) => string | null;
};
export function scenarios(): Scenario[] {
  const ids = [...new Set(Object.values(CATEGORY_MAP).flatMap((v) => v ?? []))];
  const defaults = [...DEFAULT_CATEGORIES, ...BUILT_IN_CATEGORIES].filter((c) => ids.includes(c.id));
  const customId = (name: string) => `custom:${name}`;
  const own = Object.keys(CATEGORY_MAP).map((name) => ({ id: customId(name), name }));
  const defaultToOwn = new Map<string, string[]>();
  for (const [name, accepted] of Object.entries(CATEGORY_MAP)) for (const id of accepted ?? []) {
    defaultToOwn.set(id, [...(defaultToOwn.get(id) ?? []), customId(name)]);
  }
  const toOwn = (id: string | null) => {
    const mapped = id ? defaultToOwn.get(id) : null;
    return mapped?.length === 1 ? mapped[0] : null;
  };
  return [
    { title: "A: Own category list", categories: own, acceptable: (p) => [customId(p.trueCategory)],
      starter: (p) => toOwn(starterCategory(p, defaults)), structural: toOwn },
    { title: "B: Default category list", categories: [
      ...defaults.map((c) => ({ id: c.id, name: c.name.en })),
      ...Object.entries(CATEGORY_MAP).filter(([, ids]) => ids === null).map(([name]) => ({ id: customId(name), name })),
    ], acceptable: (p) => CATEGORY_MAP[p.trueCategory] ?? [customId(p.trueCategory)],
    starter: (p) => starterCategory(p, defaults), structural: (id) => id },
  ];
}
const correct = (scenario: Scenario, payment: BenchPayment, id: string | null) => id !== null && scenario.acceptable(payment).includes(id);
type Prediction = { id: string | null; structural: boolean };
// The engine's answer for every payment in `payments`, from one sortPayments call over all of them, as the app sorts:
// the structural rules (own transfers) look across the payments. Learning always wins over starter rules; with
// `starter` false only structural and learned results count (the learning-only baseline).
export function sortAll(s: Scenario, payments: readonly BenchPayment[], learned: Learned, starter = true): Prediction[] {
  return sortPayments(payments, { categories: s.categories, learned }).map((result, i) => {
    if (result.source === "structural") return { id: s.structural(result.categoryId!), structural: true };
    const id = result.source === "learned" ? result.categoryId : starter ? result.categoryId ?? s.starter(payments[i]) : null;
    return { id, structural: false };
  });
}
// If a broad answer category accepts several defaults, learn the first listed id.
// This does not use hidden information about which of those defaults a person prefers.
const correction = (s: Scenario, p: BenchPayment) => s.acceptable(p)[0];
const share = (count: number, total: number) => total ? `${(count * 100 / total).toFixed(1)}% (${count}/${total})` : "n/a (0/0)";
type MonthStats = { total: number; sorted: number; right: number };
type Replay = { fixes: number; firstMonth: number; first100: number; months: Map<string, MonthStats>; predictions: (string | null)[] };
// Payments in date order, each sorted when it arrives: one sortPayments call over all payments up to and including
// it (a transfer's second side pairs with its first; the first side cannot see the second yet).
export function replay(payments: readonly BenchPayment[], scenario: Scenario, starter = true): Replay {
  let learned: Learned = {};
  const result: Replay = { fixes: 0, firstMonth: 0, first100: 0, months: new Map(), predictions: [] };
  payments.forEach((p, index) => {
    const id = sortAll(scenario, payments.slice(0, index + 1), learned, starter)[index].id;
    const right = correct(scenario, p, id);
    const month = p.date.slice(0, 7);
    const stats = result.months.get(month) ?? { total: 0, sorted: 0, right: 0 };
    stats.total++; stats.sorted += Number(id !== null); stats.right += Number(right);
    result.months.set(month, stats);
    result.predictions.push(id);
    if (!right) {
      result.fixes++;
      result.first100 += Number(index < 100);
      result.firstMonth += Number(month === payments[0]?.date.slice(0, 7));
      learned = learn(learned, p, correction(scenario, p));
    }
  });
  return result;
}
function confusions(s: Scenario, payments: readonly BenchPayment[], ids: readonly (string | null)[]): string {
  const names = new Map(s.categories.map((c) => [c.id, c.name]));
  const counts = new Map<string, { from: string; to: string; count: number }>();
  payments.forEach((p, i) => {
    if (correct(s, p, ids[i])) return;
    const from = p.trueCategory, to = ids[i] === null ? "Not sorted" : names.get(ids[i]!) ?? "Not sorted";
    const key = JSON.stringify([from, to]);
    const row = counts.get(key) ?? { from, to, count: 0 };
    row.count++; counts.set(key, row);
  });
  const rows = [...counts.values()].sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to)).slice(0, 10);
  return rows.length ? "| True category | Predicted category | Count |\n|---|---|---:|\n" + rows.map((r) => `| ${r.from} | ${r.to} | ${r.count} |`).join("\n") : "No confusions.";
}
function usage(batches: BatchMetrics[], model: string, count: number): string {
  const requests = batches.reduce((n, b) => n + b.requests, 0);
  const inputs = batches.reduce((n, b) => n + (b.inputTokens ?? 0), 0);
  const outputs = batches.reduce((n, b) => n + (b.outputTokens ?? 0), 0);
  const seconds = batches.reduce((n, b) => n + b.seconds, 0);
  const missing = batches.some((b) => b.inputTokens === null || b.outputTokens === null);
  const failed = batches.filter((b) => b.error).length;
  const price = PRICES[model];
  const cost = !missing && price ? (inputs * price.input + outputs * price.output) / 1_000_000 : null;
  return `| Requests | Batches | Input tokens | Output tokens | Seconds | Seconds/payment | Estimated USD | USD/payment | Failed batches |\n|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n| ${requests} | ${batches.length} | ${inputs}${missing ? " (partial)" : ""} | ${outputs}${missing ? " (partial)" : ""} | ${seconds.toFixed(3)} | ${count ? (seconds / count).toFixed(4) : "n/a"} | ${cost === null ? "unavailable" : cost.toFixed(6)} | ${cost === null || !count ? "n/a" : (cost / count).toFixed(8)} | ${failed} |`;
}
async function ask(s: Scenario, payments: readonly BenchPayment[], options: GroqOptions) {
  // Fresh references, unrelated to bank or export ids. Never send the answer key.
  const response = await autoSort(s.categories.map((c) => c.name), payments.map((p, i) => ({
    reference: `sort-${i + 1}`, date: p.date, amount: p.amount, description: p.description, counterparty: p.counterparty,
  })), options);
  const byName = new Map(s.categories.map((c) => [c.name, c.id]));
  const byRef = new Map(response.results.map((r) => [r.reference, r.category === null ? null : byName.get(r.category) ?? null]));
  return { ids: payments.map((_, i) => byRef.get(`sort-${i + 1}`) ?? null), batches: response.batches };
}
async function monthlyAuto(payments: readonly BenchPayment[], s: Scenario, options: GroqOptions | null) {
  let learned: Learned = {};
  let fixes = 0;
  const ids: (string | null)[] = [];
  const batches: BatchMetrics[] = [];
  const months = [...new Set(payments.map((p) => p.date.slice(0, 7)))];
  let sent = 0;
  let end = 0;
  for (const month of months) {
    // Payments are in date order, so the month's import ends the list so far.
    const start = end;
    while (end < payments.length && payments[end].date.slice(0, 7) === month) end++;
    const group = payments.slice(start, end);
    // Freeze learning for the import, then apply all corrections for the next month.
    const initial = sortAll(s, payments.slice(0, end), learned).slice(start).map((r) => r.id);
    const open = group.filter((_, i) => initial[i] === null);
    const response = options ? await ask(s, open, options) : null;
    sent += options ? open.length : 0;
    batches.push(...(response?.batches ?? []));
    let cursor = 0;
    const predicted = initial.map((id) => id ?? response?.ids[cursor++] ?? null);
    predicted.forEach((id, i) => {
      if (!correct(s, group[i], id)) { fixes++; learned = learn(learned, group[i], correction(s, group[i])); }
    });
    ids.push(...predicted);
  }
  return { fixes, ids, batches, sent };
}
export async function buildReport(input: readonly BenchPayment[], options: { limit?: number; groq?: GroqOptions } = {}): Promise<string> {
  // Validation also keeps category names in reports restricted to the supplied taxonomy.
  const payments = parseData(input).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1)) throw new Error("Limit must be a positive integer");
  const data = options.limit === undefined ? payments : payments.slice(0, options.limit);
  const lines = ["# Sorting measurements", "", `Payments: ${data.length}. Answer key: rule or manual categories only.`, "",
    `Sorting: one sortPayments call over all payments up to the point in the replay, so the structural rules (own transfers) run first. Payments with source and account: ${data.filter((p) => p.source && p.account).length}; with the other party's IBAN: ${data.filter((p) => p.counterpartyIban).length}.`, "",
    "Shares show counts and denominators. n/a means no eligible payments. Month labels use UTC booking months.", "",
    "M2 applies corrections immediately in date order. Automatically sorted includes wrong predictions; automatically right excludes them. First 100 uses all available payments up to 100.", "",
    "Confusions include missing predictions as Not sorted. Learning happens only after a wrong or missing prediction.", ""];
  if (!options.groq) lines.push("M3: skipped (enable with --groq).", "");
  for (const s of scenarios()) {
    // M1: a new user's first import of everything, sorted at once with nothing learned.
    const first = sortAll(s, data, {});
    const starters = first.map((r) => r.id);
    const sorted = starters.filter((id) => id !== null).length;
    const right = starters.filter((id, i) => correct(s, data[i], id)).length;
    const structural = first.filter((r) => r.structural).length;
    const structuralRight = first.filter((r, i) => r.structural && correct(s, data[i], r.id)).length;
    const m2 = replay(data, s), learnedOnly = replay(data, s, false);
    lines.push(`## ${s.title}`, "", "| Measurement | Result |", "|---|---:|",
      `| M1: share sorted (structural and starter rules) | ${share(sorted, data.length)} |`,
      `| M1: right among sorted | ${share(right, sorted)} |`,
      `| M1: own transfers (structural rules) | ${share(structural, data.length)} |`,
      `| M1: right among own transfers | ${share(structuralRight, structural)} |`,
      `| M2: fixes total | ${m2.fixes} |`, `| M2: fixes first month | ${m2.firstMonth} |`,
      `| M2: fixes first 100 | ${m2.first100} |`,
      `| M2: learning only, fixes total | ${learnedOnly.fixes} |`,
      `| M2: learning only, fixes first month | ${learnedOnly.firstMonth} |`,
      `| M2: learning only, fixes first 100 | ${learnedOnly.first100} |`, "",
      "| Month | Payments | Automatically sorted | Automatically right | Learning only: automatically sorted |", "|---|---:|---:|---:|---:|");
    for (const [month, stats] of m2.months) {
      const baseline = learnedOnly.months.get(month)!;
      lines.push(`| ${month} | ${stats.total} | ${share(stats.sorted, stats.total)} | ${share(stats.right, stats.total)} | ${share(baseline.sorted, baseline.total)} |`);
    }
    lines.push("", "### M1 confusions", "", confusions(s, data, starters), "", "### M2 confusions", "", confusions(s, data, m2.predictions), "");
    if (options.groq) {
      const open = data.filter((_, i) => starters[i] === null);
      const fresh = await ask(s, open, options.groq);
      const freshRight = fresh.ids.filter((id, i) => correct(s, open[i], id)).length;
      const freshSorted = fresh.ids.filter((id) => id !== null).length;
      const baseline = await monthlyAuto(data, s, null);
      const auto = await monthlyAuto(data, s, options.groq);
      const model = options.groq.model ?? DEFAULT_MODEL;
      lines.push("### M3: New user", "", "| Measurement | Result |", "|---|---:|",
        `| Open after structural and starter rules | ${open.length} |`, `| Groq share right among all open | ${share(freshRight, open.length)} |`,
        `| Groq share answered | ${share(freshSorted, open.length)} |`, "", usage(fresh.batches, model, open.length), "",
        "### M3: Monthly imports", "", "Each month is classified with learning from earlier months only, then corrected. This comparison uses the same monthly imports with and without Groq; M2 above uses immediate corrections.", "",
        "| Measurement | Result |", "|---|---:|", `| Fixes without Groq | ${baseline.fixes} |`,
        `| Fixes with Groq | ${auto.fixes} |`, `| Payments sent to Groq | ${auto.sent} |`, "", usage(auto.batches, model, auto.sent), "",
        "### M3 new-user confusions", "", confusions(s, open, fresh.ids), "", "### M3 replay confusions", "", confusions(s, data, auto.ids), "");
    }
  }
  if (options.groq) {
    const model = options.groq.model ?? DEFAULT_MODEL, price = PRICES[model];
    // Only print known model ids: CLI values must not become an output channel for payment text.
    lines.push(`Price model: ${price ? model : "unlisted model (cost unavailable)"}.`, "",
      price ? `USD per million tokens: input ${price.input}, output ${price.output}. ${price.legacy ? "Historical public rate only; current enterprise price is not public. Llama models retired for free/developer accounts on 2026-08-16." : "Published on-demand rate."}` : "No price constant for this model.", "",
      `Pricing checked ${PRICE_DATE}: [Groq model pricing](${PRICE_SOURCE}). Cost excludes retries with unreported usage; missing usage makes the estimate unavailable.`, "");
  }
  return lines.join("\n") + "\n";
}
export function parseArgs(args: string[]): { limit?: number; groq: boolean; model: string } {
  const result: { limit?: number; groq: boolean; model: string } = { groq: false, model: DEFAULT_MODEL };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--groq") result.groq = true;
    else if (arg === "--model" && args[i + 1] && !args[i + 1].startsWith("--")) result.model = args[++i];
    else if (arg === "--limit" && args[i + 1] && /^[1-9]\d*$/.test(args[i + 1])) result.limit = Number(args[++i]);
    else throw new Error("Usage: npx tsx bench/run.ts [--groq] [--model id] [--limit n]");
  }
  if (result.limit !== undefined && !Number.isSafeInteger(result.limit)) throw new Error("Limit must be a positive integer");
  return result;
}
export async function run(args = process.argv.slice(2), overrides: Pick<GroqOptions, "fetch" | "sleep"> = {}): Promise<string> {
  const options = parseArgs(args);
  // Another OpenAI-compatible provider (NVIDIA, for comparison): SORT_API_URL and SORT_API_KEY replace Groq's.
  const apiKey = process.env.SORT_API_KEY ?? process.env.GROQ_API_KEY;
  const endpoint = process.env.SORT_API_URL;
  if (options.groq && !apiKey) throw new Error("GROQ_API_KEY (or SORT_API_KEY) is required for --groq");
  const input = parseData(JSON.parse(await readFile(DATA_FILE, "utf8")));
  const report = await buildReport(input, { limit: options.limit,
    groq: options.groq ? { apiKey: apiKey!, model: options.model, endpoint, ...overrides } : undefined });
  await mkdir(new URL("out/", import.meta.url), { recursive: true });
  await writeFile(RESULTS_FILE, report, { mode: 0o600 });
  console.log(report);
  return report;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { await run(); } catch { console.error("Bench failed. Check input shape, flags and GROQ_API_KEY; payment details withheld."); process.exitCode = 1; }
}
