import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import { buildDashboardSource, type SourcePayment } from "../engine/source.js";
import { buildDashboard, type Category, type DashboardSource, type SourceTxn } from "./dashboard.js";

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
    databaseCategoryNames: ["Food", "Theme", "Health", "Uncategorised", "Tax", "Income", "Transfer"],
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
  assert.equal(d.total.expense, -3); // 10 - 15 refund + 2; the 7 of unsorted money in is income only
  assert.deepEqual(d.total.categories, [{ name: "Food", total: 12 }, { name: "Theme", total: 12 }]);
});

test("spend-category refund goes to Refunds and spend series clamp at zero", () => {
  const d = buildDashboard(fixture());
  assert.deepEqual(d.transactions[2].incomeBuckets, ["Refunds", "Income", "Tax"]);
  assert.deepEqual(d.spend.Health.months, [0, 0]);
  assert.equal(d.spend.Health.days["2026-01"][1], 0);
  assert.deepEqual(d.income.Refunds.months, [15, 0]);
  assert.equal(d.byMonth["2026-01"].dayExpense[1], -15);
});

// Money moved between one's own accounts (a transfer category) counts as neither spending nor income
// (Patrik, 2026-10-27); a transfer tag on an income payment does not make a Transfer income row either.
test("uncategorised money in uses Other; transfers count as neither spending nor income", () => {
  const d = buildDashboard(fixture());
  assert.deepEqual(d.transactions[1].incomeBuckets, ["Income", "Tax"]);
  assert.deepEqual(d.transactions[3].incomeBuckets, ["Other"]);
  assert.deepEqual(d.transactions[4].incomeBuckets, []);
  assert.deepEqual(d.transactions[5].incomeBuckets, []);
  assert.equal(d.byMonth["2026-01"].dayExpense[2], 0);
  assert.equal(d.total.income, 42);
  assert.deepEqual(d.total.incomeBuckets, [
    { name: "Income", total: 35 }, { name: "Tax", total: 35 }, { name: "Refunds", total: 15 }, { name: "Other", total: 7 },
  ]);
  assert.ok(d.pick.income.includes("Transfer"), "incoming money can still be moved to a transfer category");
  assert.equal(d.incomeBuckets.find((c) => c.name === "Other")?.icon, "CircleHelp");
});

// "Not sorted" (Uncategorised) counts money out only; unsorted money in is income under "Other" (Patrik, 2026-10-27).
// Before, the 150 below lowered Not sorted's spending to -130, so the month vanished from its list ("No activity
// recorded"). Run through buildDashboardSource, as the server and the phone do.
test("unsorted money in is income in Other only; Not sorted shows the money out; refunds still lower their category", () => {
  const look = (name: string) => ({ name, icon: "Tag", color: "#123456", excludeFromTotals: false });
  const pay = (id: string, date: string, amount: number, category: string | null): SourcePayment => ({
    id, externalId: id, date, amount, currency: "EUR", description: "Fiktiv", counterparty: "Fiktiv", category,
  });
  const d = buildDashboard(buildDashboardSource({
    categories: [look("Groceries")],
    today: "2026-03-31",
    transactions: [
      pay("in", "2026-03-05", 150, null), // a salary from a new employer, not sorted yet
      pay("out", "2026-03-07", -20, null),
      pay("shop", "2026-03-10", -30, "Groceries"),
      pay("refund", "2026-03-12", 12, "Groceries"),
    ],
  }));
  const march = d.byMonth["2026-03"];
  assert.deepEqual(march.categories, [{ name: "Uncategorised", total: 20 }, { name: "Groceries", total: 18 }]);
  assert.deepEqual(d.spend.Uncategorised.months, [20]);
  assert.equal(d.spend.Uncategorised.days["2026-03"][4], 0);
  assert.equal(d.spend.Uncategorised.days["2026-03"][6], 20);
  assert.deepEqual(march.incomeBuckets, [{ name: "Other", total: 150 }, { name: "Refunds", total: 12 }]);
  assert.deepEqual(d.income.Other.months, [150]);
  // The expense total is not lowered by the 150: 20 unsorted out + 30 groceries - 12 refund.
  assert.equal(march.expense, 38);
  assert.equal(d.total.expense, 38);
  assert.equal(march.income, 162);
  assert.equal(march.dayExpense[4], 0);
  assert.equal(march.dayExpenseRunning.at(-1), 38);
  const byId = new Map(d.transactions.map((t) => [t.id, t]));
  assert.deepEqual([byId.get("in")!.categoriesIn, byId.get("in")!.incomeBuckets], [[], ["Other"]]);
  assert.deepEqual([byId.get("out")!.categoriesIn, byId.get("out")!.incomeBuckets], [["Uncategorised"], []]);
  assert.deepEqual(byId.get("refund")!.categoriesIn, ["Groceries"]);
  assert.equal(byId.get("in")!.categoryName, "Uncategorised", "the payment keeps its real name for Switch and Add");
});

test("bank balances carry over unbooked days and partial months stop at supplied day", () => {
  const d = buildDashboard(fixture());
  assert.equal(d.byMonth["2026-01"].dayBalance[3], 118);
  assert.equal(d.byMonth["2026-01"].endBalance, 118);
  assert.deepEqual(d.byMonth["2026-02"].dayBalance, [127, 125, 125]);
  assert.deepEqual(d.byMonth["2026-02"].dayExpense, [0, 2, 0]);
  assert.deepEqual(d.byMonth["2026-02"].dayIncome, [0, 0, 0]);  // the incoming transfer is not income
  assert.deepEqual(d.overview, { expense: [-5, 2], income: [42, 0], balance: [118, 125] });
  assert.equal(d.months[1].partial, true);
  for (const series of [...Object.values(d.spend), ...Object.values(d.income)]) assert.equal(series.days["2026-02"].length, 3);
});

test("builder leaves its source untouched", () => {
  const source = fixture();
  const before = structuredClone(source);
  buildDashboard(source);
  assert.deepEqual(source, before);
});

// The values below were produced by the old browser calculation (web/public/app/data.js before /api/data
// version 2) and matched by buildDashboard when the switch was checked on 2026-10-23; they pin its addition
// order, cent rounding, income-row ties and bookings outside a partial month. Since 2026-10-27 the fixture's 7 of
// unsorted money in no longer lowers spending, so January's and the total expense are 7 higher than the old values.
test("addition order, cent rounding, income ties and out-of-window bookings keep the old results", () => {
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
  const d = buildDashboard(source);
  assert.deepEqual(d.total.incomeBuckets.map((b) => [b.name, b.total]),
    [["Refunds", 100000000000015], ["Income", 235], ["Second income", 200], ["Tax", 35], ["Other", 7]]);
  assert.deepEqual(d.byMonth["2026-02"].incomeBuckets.map((b) => [b.name, b.total]),
    [["Income", 100], ["Second income", 100]]);
  assert.deepEqual([d.total.expense, d.byMonth["2026-01"].expense, d.byMonth["2026-02"].expense], [-1.99, -5, 3.01]);
  assert.deepEqual(d.byMonth["2026-02"].dayExpense, [0.01, 2, 0]);
  assert.deepEqual(d.byMonth["2026-02"].dayExpenseRunning, [0.01, 2.01, 2.01]);
  assert.deepEqual(d.spend.Food.months, [10, 3.01]);
  assert.deepEqual(d.total.categories, [{ name: "Food", total: 13.01 }, { name: "Theme", total: 12 }]);
});

test("equal income rows keep each month's own first-transaction order", async () => {
  const source = fixture();
  source.categories.push(category("Second income", "income"));
  source.transactions = [
    txn("a", "2026-01-01", 100, "Second income"), txn("b", "2026-01-02", 100, "Income"),
    txn("c", "2026-02-01", 100, "Income"), txn("d", "2026-02-02", 100, "Second income"),
  ];
  const d = buildDashboard(source);
  assert.deepEqual(d.total.incomeBuckets.map((b) => b.name), ["Second income", "Income"]);
  assert.deepEqual(d.byMonth["2026-01"].incomeBuckets.map((b) => b.name), ["Second income", "Income"]);
  assert.deepEqual(d.byMonth["2026-02"].incomeBuckets.map((b) => b.name), ["Income", "Second income"]);
});

test("an empty source gives an empty dashboard", () => {
  const d = buildDashboard({ categories: [], months: [], transactions: [], balanceByDay: {}, openingBalance: 0, databaseCategoryNames: [] });
  assert.deepEqual(d, {
    version: 2, months: [], categories: [], pick: { spend: [], income: [] }, incomeBuckets: [], transactions: [],
    total: { expense: 0, income: 0, categories: [], incomeBuckets: [] }, byMonth: {}, spend: {}, income: {},
    overview: { expense: [], income: [], balance: [] },
  });
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
  assert.equal(captured.expenseTotal(null), -3);
  // Model a successful Switch and Add, whose figures only change after re-fetching.
  source.transactions[0].categoryName = "Transfer";
  source.transactions[0].tags = ["Health"];
  await captured.refresh();
  assert.equal(requested, true);
  assert.equal(window.AresiumData, captured);
  assert.equal(captured.expenseTotal(null), -13);
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

test("dayExpenseRunning: running total of the month's spending, one value per day", () => {
  const d = buildDashboard(fixture());
  for (const m of d.months) {
    const mo = d.byMonth[m.key];
    assert.equal(mo.dayExpenseRunning.length, m.days);
    let sum = 0;
    mo.dayExpense.forEach((v, i) => { sum += v; assert.ok(Math.abs(mo.dayExpenseRunning[i] - sum) < 0.011, `${m.key} day ${i + 1}`); });
  }
});

test("pick excludes a synthesised Uncategorised but keeps a real one under the kind rules", () => {
  for (const kind of ["spend", "income", "transfer"] as const) {
    const source = fixture();
    source.categories.find((c) => c.name === "Uncategorised")!.kind = kind;
    source.databaseCategoryNames = source.databaseCategoryNames.filter((n) => n !== "Uncategorised");
    const synthetic = buildDashboard(source);
    assert.ok(synthetic.categories.some((c) => c.name === "Uncategorised"));
    assert.ok(!synthetic.pick.spend.includes("Uncategorised"));
    assert.ok(!synthetic.pick.income.includes("Uncategorised"));

    source.databaseCategoryNames.push("Uncategorised");
    const real = buildDashboard(source);
    assert.equal(real.pick.spend.includes("Uncategorised"), kind === "spend");
    assert.equal(real.pick.income.includes("Uncategorised"), kind !== "spend");
    const { pick: syntheticPick, ...syntheticData } = synthetic;
    const { pick: realPick, ...realData } = real;
    assert.deepEqual(syntheticData, realData, "only pick may change; source category names must not leak into the payload");
  }
});
