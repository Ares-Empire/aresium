import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import { buildDashboard, type Category, type DashboardSource, type SourceTxn } from "./dashboard.js";
import { checkDashboard } from "../../scripts/check-dashboard.js";

const category = (name: string, kind: Category["kind"] = "spend"): Category => ({ name, kind, icon: "Tag", color: "#123456" });
const txn = (id: string, date: string, amount: number, categoryName: string, tags: string[] = []): SourceTxn =>
  ({ id, date, amount, categoryName, tags, place: "Sample shop", city: "Sample city" });

function fixture(): DashboardSource {
  const months = [
    { key: "2026-01", label: "Jan 2026", short: "Jan", year: 2026, month: 0, days: 31, partial: false },
    { key: "2026-02", label: "Feb 2026", short: "Feb", year: 2026, month: 1, days: 3, partial: true },
  ];
  return {
    months,
    categories: [category("Food"), category("Theme"), category("Health"), category("Uncategorised"), category("Tax"), category("Income", "income"), category("Transfer", "transfer")],
    transactions: [
      txn("tagged", "2026-01-01", -10, "Food", ["Theme", "Theme", "Food", "Income"]),
      txn("pay", "2026-01-01", 20, "Income", ["Transfer", "Tax", "Transfer"]),
      txn("refund", "2026-01-02", 15, "Health", ["Income", "Tax"]),
      txn("uncat", "2026-01-02", 7, "Uncategorised"),
      txn("outgoing-transfer", "2026-01-03", -4, "Transfer"),
      txn("incoming-transfer", "2026-02-01", 9, "Transfer", ["Income"]),
      txn("partial-spend", "2026-02-02", -2, "Food", ["Theme"]),
    ],
    openingBalance: 110,
    balanceByDay: Object.fromEntries([
      ...Array.from({ length: 31 }, (_, i) => [`2026-01-${String(i + 1).padStart(2, "0")}`, i === 0 ? 100 : i === 1 ? 122 : 118]),
      ["2026-02-01", 127], ["2026-02-02", 125], ["2026-02-03", 125],
    ]),
  };
}

test("tagged spend appears in both categories but contributes once to expense", () => {
  const d = buildDashboard(fixture());
  assert.deepEqual(d.transactions[0].categoriesIn, ["Food", "Theme", "Income"]);
  assert.deepEqual(d.transactions[0].incomeBuckets, []);
  assert.deepEqual(d.byMonth["2026-01"].categories, [{ name: "Food", total: 10 }, { name: "Theme", total: 10 }]);
  assert.equal(d.byMonth["2026-01"].dayExpense[0], 10);
  assert.equal(d.total.expense, -10); // 10 - 15 refund - 7 uncategorised credit + 2
  assert.deepEqual(d.total.categories, [{ name: "Food", total: 12 }, { name: "Theme", total: 12 }]);
});

test("spend-category refund goes to Refunds and spend series clamp at zero", () => {
  const d = buildDashboard(fixture());
  assert.deepEqual(d.transactions[2].incomeBuckets, ["Refunds", "Income", "Tax"]);
  assert.deepEqual(d.spend.Health.months, [0, 0]);
  assert.equal(d.spend.Health.days["2026-01"][1], 0);
  assert.deepEqual(d.income.Refunds.months, [15, 0]);
  assert.equal(d.byMonth["2026-01"].dayExpense[1], -22);
});

test("uncategorised money in uses Other; transfers do not add to expense", () => {
  const d = buildDashboard(fixture());
  assert.deepEqual(d.transactions[3].incomeBuckets, ["Other"]);
  assert.deepEqual(d.transactions[4].incomeBuckets, []);
  assert.deepEqual(d.transactions[5].incomeBuckets, ["Transfer", "Income"]);
  assert.equal(d.byMonth["2026-01"].dayExpense[2], 0);
  assert.equal(d.total.income, 51);
  assert.deepEqual(d.total.incomeBuckets, [
    { name: "Income", total: 44 }, { name: "Tax", total: 35 }, { name: "Transfer", total: 29 },
    { name: "Refunds", total: 15 }, { name: "Other", total: 7 },
  ]);
  assert.equal(d.incomeBuckets.find((c) => c.name === "Other")?.icon, "CircleHelp");
});

test("bank balances carry over unbooked days and partial months stop at supplied day", () => {
  const d = buildDashboard(fixture());
  assert.equal(d.byMonth["2026-01"].dayBalance[3], 118);
  assert.equal(d.byMonth["2026-01"].endBalance, 118);
  assert.deepEqual(d.byMonth["2026-02"].dayBalance, [127, 125, 125]);
  assert.deepEqual(d.byMonth["2026-02"].dayExpense, [0, 2, 0]);
  assert.deepEqual(d.byMonth["2026-02"].dayIncome, [9, 0, 0]);
  assert.deepEqual(d.overview, { expense: [-12, 2], income: [42, 9], balance: [118, 125] });
  assert.equal(d.months[1].partial, true);
  for (const series of [...Object.values(d.spend), ...Object.values(d.income)]) assert.equal(series.days["2026-02"].length, 3);
});

test("builder leaves its source untouched", () => {
  const source = fixture();
  const before = structuredClone(source);
  buildDashboard(source);
  assert.deepEqual(source, before);
});

test("every adapter result equals legacy for tagged, refunded and partial data", async () => {
  const result = await checkDashboard(fixture());
  assert.equal(result.mismatches, 0, result.firstMismatches.join("\n"));
});

test("addition order, cent rounding, income ties and out-of-window bookings match legacy", async () => {
  const source = fixture();
  source.categories.push(category("Second income", "income"));
  source.transactions.push(
    txn("tie1", "2026-01-02", 100, "Second income"),
    txn("tie2", "2026-01-02", 100, "Income"),
    txn("tie3", "2026-02-01", 100, "Income"),
    txn("tie4", "2026-02-01", 100, "Second income"),
    txn("future", "2026-02-20", -1.005, "Food"),
    txn("large", "2026-01-02", -1e14, "Food"),
    txn("small", "2026-02-01", -0.005, "Food"),
    txn("cancel", "2026-01-02", 1e14, "Food"),
    txn("last", "2026-02-01", -0.005, "Food"),
  );
  const result = await checkDashboard(source);
  assert.equal(result.mismatches, 0, result.firstMismatches.join("\n"));
});

test("equal income rows keep each month's own first-transaction order", async () => {
  const source = fixture();
  source.transactions = [
    txn("a", "2026-01-01", 100, "Transfer"), txn("b", "2026-01-02", 100, "Income"),
    txn("c", "2026-02-01", 100, "Income"), txn("d", "2026-02-02", 100, "Transfer"),
  ];
  const d = buildDashboard(source);
  assert.deepEqual(d.total.incomeBuckets.map((b) => b.name), ["Transfer", "Income"]);
  assert.deepEqual(d.byMonth["2026-01"].incomeBuckets.map((b) => b.name), ["Transfer", "Income"]);
  assert.deepEqual(d.byMonth["2026-02"].incomeBuckets.map((b) => b.name), ["Income", "Transfer"]);
});

test("empty source preserves the legacy interface", async () => {
  const result = await checkDashboard({ categories: [], months: [], transactions: [], balanceByDay: {}, openingBalance: 0 });
  assert.equal(result.mismatches, 0, result.firstMismatches.join("\n"));
});


test("adapter refresh updates the captured object after edits", async () => {
  const source = fixture();
  const window: Record<string, any> = { AresiumSample: buildDashboard(source) };
  let requested = false;
  const context = createContext({
    location: { protocol: "file:" }, // the offline path: data.js reads window.AresiumSample
    window,
    fetch: async (url: string, options: { cache: string }) => {
      assert.equal(url, "/api/data");
      assert.equal(options.cache, "no-store");
      requested = true;
      return { ok: true, json: async () => buildDashboard(source) };
    },
  });
  runInContext(await readFile(new URL("../../web/public/app/data.js", import.meta.url), "utf8"), context);
  const captured = window.AresiumData;
  assert.equal(captured.expenseTotal(null), -10);
  // Model a successful Switch and Add, whose figures only change after re-fetching.
  source.transactions[0].categoryName = "Transfer";
  source.transactions[0].tags = ["Health"];
  await captured.refresh();
  assert.equal(requested, true);
  assert.equal(window.AresiumData, captured);
  assert.equal(captured.expenseTotal(null), -20);
  assert.equal(captured.categoryMonthTransactions("Food", "2026-01").length, 0);
  const listed = captured.categoryMonthTransactions("Health", "2026-01");
  assert.equal(listed[0].id, "tagged");
  assert.equal(listed[0].tagged, true);
});

test("pick lists: spend rows first in total order, the rest alphabetical; income side only income/transfer/Tax", () => {
  const d = buildDashboard(fixture());
  const rows = d.total.categories.map((r) => r.name);
  assert.deepEqual(d.pick.spend.slice(0, rows.length), rows);
  const rest = d.pick.spend.slice(rows.length);
  assert.deepEqual(rest, [...rest].sort((a, b) => a.localeCompare(b)));
  const kind = new Map(d.categories.map((c) => [c.name, c.kind]));
  assert.deepEqual(new Set(d.pick.spend), new Set(d.categories.filter((c) => c.kind === "spend").map((c) => c.name)));
  for (const n of d.pick.income) assert.ok(n === "Tax" || kind.get(n) !== "spend", n);
});
