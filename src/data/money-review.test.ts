import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { buildDashboard } from "./dashboard.js";
import { dashboardInputFromRows, type SourceRows } from "./queries.js";
import { pulseLine } from "./pulse.js";
import { webDashboard } from "./web-ledger.js";
import { buildDashboardSource, type SourcePayment } from "../engine/source.js";

const category = { name: "Fictional category", icon: "Tag", color: "#123456", excludeFromTotals: false };
const payment = (id: string, amount: number, date = "2026-10-01"): SourcePayment => ({
  id, externalId: id, date, amount, currency: "EUR", description: "Fictional shop", category: category.name,
});

test("224: a stored Uncategorised category has one spending row even with unsorted payments", () => {
  const input = {
    today: "2026-11-03",
    categories: [{ ...category, name: "Uncategorised" }],
    transactions: [
      { ...payment("sorted", -10), category: "Uncategorised" },
      { ...payment("unsorted", -5), category: null },
    ],
  };
  const d = buildDashboard(buildDashboardSource(input));
  assert.equal(d.total.expense, 15);
  assert.deepEqual(d.total.categories, [{ name: "Uncategorised", total: 15 }]);
  assert.deepEqual(d.byMonth["2026-10"].categories, d.total.categories);
  assert.equal(d.categories.length, 1);
  assert.deepEqual(d.spend.Uncategorised.months, [15]);
});

test("224: a zero-cent category net cannot change side with stored row order", () => {
  const rows = [payment("a", 0.1), payment("b", 0.2), payment("c", -0.3)];
  for (const transactions of [rows, [rows[2], rows[1], rows[0]], [rows[0], rows[2], rows[1]]]) {
    const d = buildDashboard(buildDashboardSource({ categories: [category], today: "2026-11-03", transactions }));
    assert.equal(d.categories[0].kind, "spend");
    assert.deepEqual(d.pick, { spend: [category.name], income: [] });
    assert.deepEqual([d.total.expense, d.total.income], [0.3, 0.3]);
  }
});

test("224: thousands of cent payments conserve totals across order, months and overlapping tags", () => {
  const transactions = Array.from({ length: 3000 }, (_, index) => ({
    ...payment(`fictional-${index}`, [0.1, 0.2, -0.3][index % 3], index < 1500 ? "2024-02-29" : "2026-10-25"),
    tags: [category.name, "Second category", "Second category", "Transfer"],
  }));
  transactions.push({ ...payment("transfer", -100), category: "Transfer", tags: [category.name] });
  for (const rows of [transactions, transactions.slice().reverse()]) {
    const d = buildDashboard(buildDashboardSource({
      today: "2026-11-03", transactions: rows,
      categories: [category, { ...category, name: "Second category" },
        { ...category, name: "Transfer", excludeFromTotals: true }],
    }));
    assert.deepEqual([d.total.expense, d.total.income], [300, 300]);
    assert.equal(d.byMonth["2024-02"].dayExpense[28], 150);
    assert.equal(d.byMonth["2026-10"].dayIncome[24], 150);
    assert.equal(d.byMonth["2024-02"].dayExpenseRunning.at(-1), 150);
    assert.ok(d.total.categories.every((row) => row.total === 300));
    assert.deepEqual(d.pick.spend, [category.name, "Second category", "Transfer"]);
  }
});

const rows: SourceRows = {
  categories: [{ id: "fictional-category", ...category } as SourceRows["categories"][number]],
  transactions: [payment("september", -100, "2026-09-01"), payment("october", -200),
    payment("november", -10, "2026-11-01")].map((p) => ({
    ...p, accountId: "fictional-account", bookingDate: new Date(p.date + "T00:00:00Z"),
    createdAt: new Date("2026-11-01T00:05:00Z"), category: { id: "fictional-category", ...category }, tags: [],
  })) as unknown as SourceRows["transactions"],
};
const db = {
  transaction: { findMany: async () => rows.transactions },
  category: { findMany: async () => rows.categories },
  webSettings: { findUnique: async () => null },
} as unknown as Prisma.TransactionClient;

test("224: Berlin midnight finishes October, not November, in the website average", async () => {
  const d = await webDashboard(db, new Date("2026-10-31T23:30:00Z"));
  assert.equal(d.monthlyAverage.expenses?.amount, 150);
  assert.equal(d.today, "2026-11-01");
  assert.equal(d.currentMonth, "2026-10");
  assert.equal(d.months.at(-1)?.days, 1);
  assert.equal(d.months.at(-1)?.partial, true);
  assert.deepEqual(d.byMonth["2026-11"].dayExpense, [10]);
  assert.deepEqual([d.total.expense, d.total.income], [310, 0]);
});

test("224: server today follows Berlin across midnight, leap day, year end and DST changes", () => {
  const cases = [
    ["2026-10-31T23:30:00Z", "2026-11-01"],
    ["2026-12-31T23:30:00Z", "2027-01-01"],
    ["2024-02-28T23:30:00Z", "2024-02-29"],
    ["2024-02-29T23:30:00Z", "2024-03-01"],
    ["2026-03-28T22:30:00Z", "2026-03-28"],
    ["2026-03-29T22:30:00Z", "2026-03-30"],
    ["2026-10-24T22:30:00Z", "2026-10-25"],
    ["2026-10-25T22:30:00Z", "2026-10-25"],
  ];
  for (const [instant, day] of cases) {
    const input = dashboardInputFromRows(rows, new Date(instant));
    assert.equal(input.today, day, instant);
    assert.equal(input.transactions[0].date, "2026-09-01T00:00:00.000Z", "booking days stay unchanged");
  }
});

test("224: the pulse uses Berlin's month regardless of the server timezone", () => {
  const d = buildDashboard(buildDashboardSource({
    today: "2026-11-01", categories: [category], transactions: [payment("november", -10, "2026-11-01")],
  }));
  const previous = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/Los_Angeles", "Europe/Berlin"]) {
      process.env.TZ = zone;
      assert.equal(pulseLine(d, new Date("2026-10-31T23:30:00Z")), "€10 spent in November", zone);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
