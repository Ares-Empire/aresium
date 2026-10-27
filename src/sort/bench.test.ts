import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { buildReport, parseArgs, replay, run, scenarios, sortAll } from "../../bench/run.js";
import { benchPayments, type ExportRow } from "../../bench/export.js";
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

// Made-up payments with what the structural rules need, as the export writes them (aliases, not real accounts).
const GIRO = { source: "bank", currency: "EUR", account: "account-1", accountIban: "iban-1" } as const;
const SAVINGS = { source: "bank", currency: "EUR", account: "account-2", accountIban: "iban-2" } as const;
const PAYPAL = { source: "paypal", currency: "EUR", account: "account-3", accountIban: null } as const;
const at = (date: string, amount: number, trueCategory: string, counterparty: string, description: string, extra: Partial<BenchPayment>): BenchPayment =>
  ({ reference: `ref-${date}-${amount}`, date, amount, description, counterparty, trueCategory, ...extra });
const structuralRows = [
  at("2025-03-10", -19.99, "Subscriptions", "Streamingdienst Beispiel", "Streamingdienst Beispiel", PAYPAL),
  at("2025-03-10", 19.99, "Transfer", "Streamingdienst Beispiel", "Bankgutschrift auf PayPal-Konto", PAYPAL),
  at("2025-03-11", -19.99, "Transfer", "PayPal Europe S.a.r.l. et Cie S.C.A", "PP.4711.PP . Ihr Einkauf bei Streamingdienst Beispiel", GIRO),
  at("2025-03-15", -200, "Transfer", "Tagesgeld Beispiel", "Sparrate", { ...GIRO, counterpartyIban: "iban-2" }),
  at("2025-03-16", 200, "Transfer", "Girokonto Beispiel", "Gutschrift", SAVINGS),
  at("2025-03-20", -23.47, "Restaurants", "Pizzeria Beispiel", "Abendessen", GIRO), // equal amounts, no proof
  at("2025-03-21", 23.47, "Restaurants", "Freundin Beispiel", "Anteil zurück", SAVINGS),
];

test("the bench sorts all payments so far in one call: PayPal's lines and an own transfer are sorted structurally", async () => {
  for (const s of scenarios()) {
    const transfer = s.structural("own-transfers");
    assert.ok(transfer && s.acceptable(structuralRows[1]).includes(transfer), s.title);
    // M1: everything at once. The funding row, the bank's PayPal line and both sides of the transfer; not the near-miss.
    const first = sortAll(s, structuralRows, {});
    assert.deepEqual(first.map((r) => r.structural), [false, true, true, true, true, false, false], s.title);
    assert.ok(first.filter((r) => r.structural).every((r) => r.id === transfer));
    // Alone, the bank's PayPal line has no PayPal export beside it, so it is not structural: why the whole list matters.
    assert.equal(sortAll(s, [structuralRows[2]], {})[0].structural, false);
    // M2: in date order, the transfer's first side cannot see its second yet; the second pairs with it.
    assert.equal(sortAll(s, structuralRows.slice(0, 4), {})[3].structural, false);
    assert.equal(sortAll(s, structuralRows.slice(0, 5), {})[4].structural, true);
    const m2 = replay(structuralRows, s).predictions;
    assert.deepEqual([m2[1], m2[2], m2[4]], [transfer, transfer, transfer], s.title);
  }
  const report = await buildReport(structuralRows);
  assert.ok(report.includes("| M1: own transfers (structural rules) | 57.1% (4/7) |"));
  assert.ok(report.includes("| M1: right among own transfers | 100.0% (4/4) |"));
  assert.ok(report.includes("Payments with source and account: 7; with the other party's IBAN: 1."));
  // The monthly imports see the whole month, so both sides of the transfer pair there.
  const monthly = await buildReport(structuralRows, { groq: { apiKey: "fake", fetch: async (_, init) => {
    const payload = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ results: payload.payments.map((p: AutoPayment) => ({ reference: p.reference, category: null })) }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  } } });
  assert.ok(monthly.includes("| Open after structural and starter rules |"));
});

test("bench data keeps the structural fields, checked like the rest without echoing values", () => {
  assert.deepEqual(parseData(structuralRows), structuralRows);
  for (const bad of [{ source: "MARKED_cash" }, { account: "" }, { accountIban: 7 }, { counterpartyIban: ["MARKED"] }, { currency: 978 }]) {
    assert.throws(() => parseData([{ ...structuralRows[0], ...bad }]), (error: Error) => !error.message.includes("MARKED"));
  }
});

test("the export takes source, account and the other party's IBAN from stored rows, as aliases", () => {
  const giro = "DE89370400440532013000", savings = "DE02120300000000202051", friend = "DE75512108001245126199";
  const row = (source: "bank" | "paypal", accountId: string, iban: string | null, raw: unknown, amount: number): ExportRow => ({
    bookingDate: new Date("2025-03-15T00:00:00.000Z"), amount: { toString: () => String(amount) }, currency: "EUR",
    description: "MARKED_TEXT", counterparty: null, source, accountId, account: { iban }, raw, category: { name: "Transfer" },
  });
  const payments = benchPayments([
    // A VR Bank CSV row as the server stores it (column → cell), naming the savings account.
    row("bank", "db-giro", giro, { "IBAN Auftragskonto": giro, "IBAN Zahlungsbeteiligter": savings.replace(/(.{4})/g, "$1 ") }, -200),
    // A CAMT entry as the server stores it: money in, so the debtor's account (the giro account).
    row("bank", "db-savings", savings, { CdtDbtInd: "CRDT", NtryDtls: { TxDtls: { RltdPties: { DbtrAcct: { Id: { IBAN: giro } } } } } }, 200),
    // Money out to a friend: an IBAN that is none of the person's accounts gets its own alias.
    row("bank", "db-giro", giro, { CdtDbtInd: "DBIT", NtryDtls: [{ TxDtls: [{ RltdPties: { CdtrAcct: { Id: { IBAN: friend } } } }] }] }, -20),
    // PayPal rows have no IBAN, whatever their row holds.
    row("paypal", "db-paypal", null, { Name: "Fiktiv Shop", "IBAN Zahlungsbeteiligter": friend }, -5),
  ]);
  assert.deepEqual(payments.map((p) => [p.source, p.account, p.accountIban, p.counterpartyIban, p.amount]), [
    ["bank", "account-1", "iban-1", "iban-2", -200],
    ["bank", "account-2", "iban-2", "iban-1", 200],
    ["bank", "account-1", "iban-1", "iban-3", -20],
    ["paypal", "account-3", null, null, -5],
  ]);
  assert.deepEqual(parseData(payments), payments);
  assert.ok(!JSON.stringify(payments).includes("DE"), "no real IBAN in the bench data");
});
