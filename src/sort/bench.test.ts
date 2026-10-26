import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { buildReport, parseArgs, replay, run, scenarios } from "../../bench/run.js";
import { fakeData } from "../../bench/fake-data.js";
import { CATEGORY_MAP, DATA_FILE, RESULTS_FILE, parseData, type BenchPayment } from "../../bench/data.js";
import { DEFAULT_CATEGORIES, BUILT_IN_CATEGORIES } from "../engine/categories.js";
import type { AutoPayment } from "./groq.js";
const row = (trueCategory: string, counterparty: string, date = "2025-01-01"): BenchPayment =>
  ({ reference: `ref-${date}-${counterparty}`, date, amount: -12345.67, description: "MARKED_PRIVATE_BOOKING", counterparty, trueCategory });

test("scenario map is exact, all default ids exist, and both custom categories stay custom", () => {
  const ids = new Set([...DEFAULT_CATEGORIES, ...BUILT_IN_CATEGORIES].map((c) => c.id));
  for (const accepted of Object.values(CATEGORY_MAP)) for (const id of accepted ?? []) assert.ok(ids.has(id));
  const [a, b] = scenarios();
  assert.equal(a.categories.length, 21);
  assert.equal(a.starter(row("Travel", "MVG")), "custom:Travel");
  assert.equal(b.starter(row("Travel", "MVG")), "bus-train");
  assert.deepEqual(b.acceptable(row("Travel", "unseen")), ["travel", "bus-train", "car-fuel", "taxi-sharing"]);
  for (const name of ["Development", "Trash"]) assert.deepEqual(b.acceptable(row(name, "unseen")), [`custom:${name}`]);
  assert.ok(b.categories.some((c) => c.id === "own-transfers"));
  assert.ok(!b.categories.some((c) => c.id === "not-sorted"));
});
test("M2 learns only from corrections, overrides wrong starters and counts first month/100 accurately", () => {
  const s = scenarios()[0];
  const rows = [row("Tech", "REWE Filiale 123 Berlin"), row("Tech", "REWE Filiale 456 München", "2025-01-02"),
    row("Groceries", "ALDI", "2025-02-01"), row("Education", "Unseen school", "2025-02-02")];
  const m2 = replay(rows, s);
  assert.equal(m2.fixes, 2); assert.equal(m2.firstMonth, 1); assert.equal(m2.first100, 2);
  assert.deepEqual(m2.predictions, ["custom:Groceries", "custom:Tech", "custom:Groceries", null]);
  assert.equal(replay(rows, s, false).fixes, 3);
  const hundred = Array.from({ length: 101 }, (_, i) => ({ ...row("Tech", `Unique shop ${"ab".repeat(i + 1)}`), reference: `n${i}` }));
  assert.equal(replay(hundred, s).first100, 100); assert.equal(replay(hundred, s).fixes, 101);
});
test("M3 sends each month's unresolved payments together before learning, without future answer leakage", async () => {
  const input = [row("Development", "Cloud Example", "2025-01-01"), row("Development", "Cloud Example", "2025-01-02"), row("Development", "Cloud Example", "2025-02-01")];
  const batchSizes: number[] = [];
  const report = await buildReport(input, { groq: { apiKey: "fake", fetch: async (_, init) => {
    const body = JSON.parse(String(init?.body));
    assert.ok(!String(init?.body).includes("trueCategory"));
    const payload = JSON.parse(body.messages[1].content);
    batchSizes.push(payload.payments.length);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ results: payload.payments.map((p: AutoPayment) => ({ reference: p.reference, category: null })) }) } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }));
  } } });
  assert.deepEqual(batchSizes, [3, 2, 3, 2]); // new user, Jan import, repeated for B; February is learned
  assert.ok(report.includes("| Fixes without Groq | 2 |"));
  assert.ok(report.includes("| Fixes with Groq | 2 |"));
  assert.ok(report.includes("| M2: fixes total | 1 |"));
  assert.ok(report.includes("0.000067"));
});
test("fake-data CLI and bench CLI produce aggregate results; --groq exercises real client with fake fetch", async () => {
  // Test actual files/printing, preserving any pre-existing local bench input/output.
  const saved = await Promise.all([DATA_FILE, RESULTS_FILE].map(async (url) => { try { return await readFile(url); } catch { return null; } }));
  const oldKey = process.env.GROQ_API_KEY;
  const oldLog = console.log;
  const printed: string[] = [];
  try {
    const fake = spawnSync(process.execPath, ["--import", "tsx", "bench/fake-data.ts"], { cwd: new URL("../../", import.meta.url), encoding: "utf8" });
    assert.equal(fake.status, 0, fake.stderr);
    const plain = spawnSync(process.execPath, ["--import", "tsx", "bench/run.ts"], { cwd: new URL("../../", import.meta.url), encoding: "utf8" });
    assert.equal(plain.status, 0, plain.stderr);
    assert.ok(plain.stdout.includes("M3: skipped"));
    console.log = (...args: unknown[]) => { printed.push(args.join(" ")); };
    process.env.GROQ_API_KEY = "fake-key";
    let calls = 0;
    const report = await run(["--groq", "--model", "openai/gpt-oss-120b"], { fetch: async (_, init) => {
      calls++;
      const payload = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
      assert.ok(payload.payments.length <= 25);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ results: payload.payments.map((p: AutoPayment) => ({ reference: p.reference, category: "Development" })) }) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    } });
    assert.ok(calls > 0);
    assert.equal(await readFile(RESULTS_FILE, "utf8"), report);
    assert.ok(printed.includes(report));
    for (const output of [plain.stdout, report, ...printed]) {
      assert.ok(output.includes("A: Own category list")); assert.ok(output.includes("B: Default category list"));
      for (const p of fakeData()) {
        assert.ok(!output.includes(p.description), "booking text disclosed");
        assert.ok(!output.includes(p.counterparty!), "counterparty disclosed");
        assert.ok(!output.includes(p.reference), "reference disclosed");
        assert.ok(!output.includes(p.date), "single payment date disclosed");
        assert.ok(!output.includes(String(p.amount)), "amount disclosed");
      }
      assert.ok(!output.includes("MARKED_BOOKING_"));
    }
  } finally {
    console.log = oldLog;
    if (oldKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldKey;
    const { writeFile } = await import("node:fs/promises");
    for (const [i, url] of [DATA_FILE, RESULTS_FILE].entries()) {
      if (saved[i] === null) await rm(url, { force: true }); else await writeFile(url, saved[i]!);
    }
  }
});
test("empty sets, chronological limit, and unknown model pricing are explicit", async () => {
  const empty = await buildReport([]);
  assert.ok(empty.includes("n/a (0/0)")); assert.ok(!empty.includes("NaN"));
  const report = await buildReport([row("Tech", "MediaMarkt", "2025-02-01"), row("Groceries", "REWE", "2025-01-01")], { limit: 1 });
  assert.ok(report.includes("2025-01")); assert.ok(!report.includes("2025-02"));
  const unknown = await buildReport([], { groq: { apiKey: "fake", model: "MARKED_MODEL", fetch: async () => { throw new Error("must not call"); } } });
  assert.ok(!unknown.includes("MARKED_MODEL")); assert.ok(unknown.includes("cost unavailable"));
});
test("invalid input/flags never echo values and cannot silently broaden a run", () => {
  assert.deepEqual(parseArgs(["--limit", "25", "--groq", "--model", "test"]), { limit: 25, groq: true, model: "test" });
  for (const args of [["--limit", "0"], ["--limit", "-1"], ["--limit", "2.5"], ["--model"], ["--unknown"]]) assert.throws(() => parseArgs(args));
  for (const bad of [null, [{}], [{ ...row("Tech", "Example"), trueCategory: "MARKED_UNKNOWN" }], [{ ...row("Tech", "Example"), date: "2025-02-31" }]]) {
    assert.throws(() => parseData(bad), (error: Error) => !error.message.includes("MARKED"));
  }
});
