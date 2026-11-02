import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { bundleEngine } from "../../scripts/build-engine.js";
import { buildDashboard } from "../data/dashboard.js";
import * as engine from "./index.js";
import { buildDashboardSource, unmatchedPaypalConversions, type SourceCategory, type SourcePayment } from "./source.js";

// Made-up payments in the shapes the server and the readers produce; fictional shops and amounts.
const look = (name: string, excludeFromTotals = false): SourceCategory => ({ name, icon: "Tag", color: "#123456", excludeFromTotals });
const categories = [look("Groceries"), look("Income"), look("Transfer", true), look("Clothes")];
let n = 0;
const pay = (date: string, amount: number, fields: Partial<SourcePayment> = {}): SourcePayment => ({
  id: `p${++n}`, externalId: `x${n}`, date, amount, currency: "EUR", description: "Kartenzahlung Fiktivmarkt",
  counterparty: "Fiktivmarkt", category: "Groceries", ...fields,
});
const build = (transactions: SourcePayment[], today = "2026-02-10", list = categories) =>
  buildDashboardSource({ transactions, categories: list, today });

test("PayPal funding rows are left out and a dollar purchase counts at its euro cost under its category", () => {
  const source = build([
    pay("2026-02-03", -18.9, { id: "shop", counterparty: "Märchenladen", category: "Clothes", raw: { Typ: "Allgemeine Zahlung" } }),
    pay("2026-02-03", 18.9, { id: "funding", description: "Bankgutschrift auf PayPal-Konto", category: "Transfer", raw: { Typ: "Bankgutschrift auf PayPal-Konto" } }),
    pay("2026-02-04", -105.91, { id: "usd", externalId: "X", currency: "USD", category: "Clothes", raw: { Typ: "PayPal Express-Zahlung" } }),
    pay("2026-02-04", 105.91, { id: "c1", currency: "USD", category: null, raw: { Typ: "Allgemeine Währungsumrechnung", "Zugehöriger Transaktionscode": "X" } }),
    pay("2026-02-04", -95.07, { id: "c2", category: null, raw: { Typ: "Allgemeine Währungsumrechnung", "Zugehöriger Transaktionscode": "X" } }),
    pay("2026-02-05", -7, { id: "gap", externalId: "Y", currency: "USD", raw: { Typ: "PayPal Express-Zahlung" } }),
  ]);
  assert.deepEqual(source.transactions.map((t) => [t.id, t.amount, t.categoryName]),
    [["shop", -18.9, "Clothes"], ["usd", -95.07, "Clothes"], ["gap", -7, "Groceries"]]);
  assert.ok(!source.categories.some((c) => c.name === "Uncategorised"), "conversion rows without a category are gone");
  assert.deepEqual(unmatchedPaypalConversions([pay("2026-02-05", -7, { externalId: "Y", currency: "USD" })]), ["Y"]);
});

test("kinds follow each category's net, excluded categories are transfers, and Uncategorised comes last only when needed", () => {
  const source = build([
    pay("2026-02-01", 1200, { category: "Income" }),
    pay("2026-02-02", -40),
    pay("2026-02-02", 25, { category: "Clothes" }), // money back only: net above zero, so income (as before)
    pay("2026-02-03", -500, { category: "Transfer" }),
  ]);
  assert.deepEqual(source.categories.map((c) => [c.name, c.kind]),
    [["Groceries", "spend"], ["Income", "income"], ["Transfer", "transfer"], ["Clothes", "income"]]);
  assert.deepEqual(source.databaseCategoryNames, ["Groceries", "Income", "Transfer", "Clothes"]);

  const open = build([pay("2026-02-02", -3, { category: null }), pay("2026-02-02", -4, { category: "Gone" })]);
  assert.deepEqual(open.transactions.map((t) => t.categoryName), ["Uncategorised", "Uncategorised"]);
  assert.deepEqual(open.categories.at(-1), { name: "Uncategorised", icon: "CircleHelp", color: "#9ca3af", kind: "spend" });
  assert.deepEqual(open.databaseCategoryNames, ["Groceries", "Income", "Transfer", "Clothes"]);
});

test("transactions keep id, day, amount, tags, place and city in the dashboard's flat shape", () => {
  const [t] = build([pay("2026-02-03T00:00:00.000Z", -12.34, {
    counterparty: null, description: "SEPA-Lastschrift Fiktivwerke", city: "Beispielstadt", tags: ["Clothes"],
  })]).transactions;
  assert.deepEqual(t, { id: t.id, date: "2026-02-03", amount: -12.34, categoryName: "Groceries", tags: ["Clothes"], place: "SEPA-Lastschrift Fiktivwerke", city: "Beispielstadt" });
  assert.equal(build([pay("2026-02-03", -1, { counterparty: "" })]).transactions[0].place, "Kartenzahlung Fiktivmarkt");
  assert.equal(build([pay("2026-02-03", -1)]).transactions[0].city, "");
});

test("a given side wins over the net, including empty income categories; transfers ignore both new fields", () => {
  const list: SourceCategory[] = [
    { ...look("Friends"), side: "spend", otherSide: true },
    { ...look("Selling things"), side: "income" },
    { ...look("Salary"), side: "income", otherSide: true },
    { ...look("Own transfers", true), side: "income", otherSide: true },
    { ...look("Savings & investing", true), side: "spend" },
    { ...look("Groceries"), otherSide: false },
  ];
  const source = build([
    pay("2026-02-01", -10, { category: "Friends" }), pay("2026-02-02", 30, { category: "Friends" }),
    pay("2026-02-03", -5, { category: "Salary" }),
  ], "2026-02-10", list);
  assert.deepEqual(source.categories, [
    { name: "Friends", icon: "Tag", color: "#123456", kind: "spend", otherSide: true },
    { name: "Selling things", icon: "Tag", color: "#123456", kind: "income" },
    { name: "Salary", icon: "Tag", color: "#123456", kind: "income", otherSide: true },
    { name: "Own transfers", icon: "Tag", color: "#123456", kind: "transfer" },
    { name: "Savings & investing", icon: "Tag", color: "#123456", kind: "transfer" },
    { name: "Groceries", icon: "Tag", color: "#123456", kind: "spend" },
  ]);
  const dashboard = buildDashboard(source);
  assert.deepEqual(dashboard.pick, {
    spend: ["Friends", "Groceries", "Own transfers", "Savings & investing", "Salary"],
    income: ["Own transfers", "Salary", "Savings & investing", "Selling things", "Friends"],
  });
  assert.deepEqual([dashboard.total.expense, dashboard.total.income], [15, 30]);
  assert.deepEqual(dashboard.total.categories, [{ name: "Friends", total: 10 }, { name: "Salary", total: 5 }]);
  assert.deepEqual(dashboard.total.incomeBuckets, [{ name: "Friends", total: 30 }]);
  assert.equal(dashboard.income.Salary, undefined);
  assert.deepEqual(dashboard.income.Friends.months, [30]);
  assert.deepEqual(dashboard.spend.Friends.months, [10]);
  assert.deepEqual(dashboard.transactions.map((t) => [t.categoriesIn, t.incomeBuckets]), [
    [["Friends"], []], [[], ["Friends"]], [["Salary"], []],
  ]);
  const withoutOtherSide = buildDashboard(build([], "2026-02-10", list.map(({ otherSide, ...c }) => c)));
  assert.ok(withoutOtherSide.pick.income.includes("Selling things"), "an empty income category can receive money");
  assert.ok(!withoutOtherSide.pick.spend.includes("Selling things"));
  const { pick, categories: meta, incomeBuckets, ...numbers } = dashboard;
  const unoffered = buildDashboard({ ...source, categories: source.categories.map(({ otherSide, ...c }) => c) });
  const { pick: unofferedPick, categories: unofferedMeta, incomeBuckets: unofferedBuckets, ...unofferedNumbers } = unoffered;
  assert.deepEqual(numbers, unofferedNumbers, "otherSide widens choices without changing any numbers");
});

test("without a side the net still chooses menus, while both directions count under the category", () => {
  const source = build([
    pay("2026-02-01", 100, { category: "Income" }),
    pay("2026-02-02", -25, { category: "Income" }),
  ]);
  assert.equal(source.categories.find((c) => c.name === "Income")!.kind, "income");
  assert.ok(source.categories.every((c) => !("otherSide" in c)));
  const dashboard = buildDashboard(source);
  assert.deepEqual([dashboard.total.income, dashboard.total.expense], [100, 25]);
  assert.deepEqual(dashboard.total.incomeBuckets, [{ name: "Income", total: 100 }]);
  assert.deepEqual(dashboard.total.categories, [{ name: "Income", total: 25 }]);
  assert.deepEqual(dashboard.transactions[1].incomeBuckets, []);
  assert.deepEqual(dashboard.transactions[1].categoriesIn, ["Income"]);
});

test("months span the payments and the current month counts up to today", () => {
  const months = build([pay("2025-12-30", -1), pay("2026-02-03", -1)], "2026-02-10").months;
  assert.deepEqual(months.map((m) => [m.key, m.label, m.short, m.year, m.month, m.days, m.partial]), [
    ["2025-12", "Dec 2025", "Dec", 2025, 11, 31, false],
    ["2026-01", "Jan 2026", "Jan", 2026, 0, 31, false],
    ["2026-02", "Feb 2026", "Feb", 2026, 1, 10, true],
  ]);
  assert.ok(build([pay("2025-12-30", -1)], "2026-02-10").months.every((m) => !m.partial));
  assert.equal(build([pay("2024-02-03", -1)], "2026-02-10").months[0].days, 29);
});

test("the balance starts at the first known one, the day's last booking wins, and gaps carry it forward", () => {
  const source = build([
    pay("2026-01-30", -10, { balance: null }),
    pay("2026-01-31", -10, { balance: 990 }),
    pay("2026-02-02", -5, { balance: 985 }),
    pay("2026-02-02", -5, { balance: 980 }),
    pay("2026-02-04", -1, { counterparty: "Märchenladen" }), // a PayPal row: no balance
  ], "2026-02-05");
  assert.equal(source.openingBalance, 990);
  assert.deepEqual(Object.entries(source.balanceByDay).slice(28), [
    ["2026-01-29", 990], ["2026-01-30", 990], ["2026-01-31", 990],
    ["2026-02-01", 990], ["2026-02-02", 980], ["2026-02-03", 980], ["2026-02-04", 980], ["2026-02-05", 980],
  ]);
  const none = build([pay("2026-02-01", -1)], "2026-02-02");
  assert.equal(none.openingBalance, 0);
  assert.deepEqual(none.balanceByDay, { "2026-02-01": 0, "2026-02-02": 0 });
});

test("payments in any order give the sorted result; same-day payments keep their order", () => {
  const payments = [pay("2026-02-01", -1, { balance: 10 }), pay("2026-02-01", -2, { balance: 20 }), pay("2026-02-03", -3, { balance: 30 }),
    pay("2026-01-15", -4, { balance: 40 })];
  const sorted = build([payments[3], payments[0], payments[1], payments[2]]);
  assert.deepEqual(build(payments), sorted);
  assert.deepEqual(sorted.transactions.map((t) => t.amount), [-4, -1, -2, -3]);
  assert.equal(sorted.balanceByDay["2026-02-01"], 20);
});

test("no payments: no months, no balance, the categories as spend", () => {
  assert.deepEqual(build([]), {
    categories: categories.map((c) => ({ name: c.name, icon: c.icon, color: c.color, kind: c.excludeFromTotals ? "transfer" : "spend" })),
    months: [], transactions: [], balanceByDay: {}, openingBalance: 0, databaseCategoryNames: categories.map((c) => c.name),
  });
});

test("the input is left unchanged and the result is plain JSON", () => {
  const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
    return value;
  };
  const input = deepFreeze({
    transactions: [pay("2026-02-03", -2, { tags: ["Clothes"], raw: { Typ: "Allgemeine Zahlung" } }), pay("2026-02-01", -1)],
    categories: categories.map((c) => ({ ...c })), today: "2026-02-10",
  });
  const source = buildDashboardSource(input);
  assert.deepEqual(JSON.parse(JSON.stringify(source)), source);
  source.transactions[1].tags.push("Groceries");
  assert.deepEqual(input.transactions[0].tags, ["Clothes"]);
});

test("dates and amounts that are not what they claim are refused with the payment's id", () => {
  for (const [date, amount] of [["03.02.2026", -1], ["2026-02-30", -1], ["2026-13-01", -1], ["2026-02-03", Number.NaN]] as const) {
    assert.throws(() => build([pay(date, amount, { id: "bad" })]), /^Error: Payment bad: /);
  }
  assert.throws(() => build([], "10.02.2026"), /today/);
});

const context = createContext({}); // No Node require/process/Buffer or web APIs injected.
runInContext(await bundleEngine(), context);
const bundled = context.AresiumEngine as typeof engine;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

test("the bundle's buildDashboardSource equals the direct one, and its dashboard too", () => {
  const transactions = [
    pay("2026-01-20", 1200, { category: "Income", balance: 1500 }), pay("2026-02-03", -18.9, { category: null, balance: 1481.1 }),
    pay("2026-02-04", -105.91, { externalId: "X", currency: "USD", raw: { Typ: "PayPal Express-Zahlung" } }),
    pay("2026-02-04", -95.07, { raw: { Typ: "Allgemeine Währungsumrechnung", "Zugehöriger Transaktionscode": "X" } }),
    pay("2026-02-05", -25, { id: "expense", category: "Income", tags: ["Income"] }),
    pay("2026-02-06", 30, { paysBack: [{ payment: "expense", amount: 40 }, { payment: "gone", amount: 1 }] }),
  ];
  const withSides: SourceCategory[] = categories.map((c) => ({ ...c, side: c.name === "Income" ? "income" : "spend", otherSide: true }));
  for (const list of [categories, withSides]) {
    const input = { categories: list, today: "2026-02-10", transactions };
    const direct = buildDashboardSource(input);
    assert.deepEqual(json(bundled.buildDashboardSource(input)), json(direct));
    assert.deepEqual(json(bundled.buildDashboard(bundled.buildDashboardSource(input))), json(buildDashboard(direct)));
  }
});

test("the bundle's transfer step and sorting equal the direct ones", () => {
  const payments = [
    // Paired by the IBAN, by both texts, and not at all (equal amounts only).
    { source: "bank" as const, account: "giro", accountIban: "DE89370400440532013000", amount: -500, date: "2026-03-01",
      counterparty: "Eigenes Tagesgeld", counterpartyIban: "DE02120300000000202051" },
    { source: "bank" as const, account: "tagesgeld", accountIban: "DE02120300000000202051", amount: 500, date: "2026-03-02", counterparty: "Eigenes Girokonto" },
    { source: "bank" as const, account: "giro", amount: -60, date: "2026-03-05", description: "Übertrag auf Tagesgeld" },
    { source: "bank" as const, account: "tagesgeld", amount: 60, date: "2026-03-05", description: "Kontoübertrag" },
    { source: "bank" as const, account: "giro", amount: -20, date: "2026-03-06", counterparty: "Fiktiv Pizzeria" },
    { source: "bank" as const, account: "tagesgeld", amount: 20, date: "2026-03-07", counterparty: "Max Mustermann" },
    { source: "bank" as const, account: "giro", amount: -18.9, date: "2026-03-03", counterparty: "PayPal Europe S.a.r.l. et Cie S.C.A" },
    { source: "paypal" as const, account: "paypal", amount: -18.9, date: "2026-03-03", counterparty: "REWE Markt" },
    { source: "paypal" as const, account: "paypal", amount: 18.9, date: "2026-03-03", counterparty: "REWE Markt", raw: { Type: "General Card Deposit" } },
  ];
  assert.deepEqual(json(bundled.ownTransfers(payments)), engine.ownTransfers(payments));
  const sorted = engine.sortPayments(payments, { categories: engine.DEFAULT_CATEGORIES });
  assert.deepEqual(json(bundled.sortPayments(payments, { categories: engine.DEFAULT_CATEGORIES })), sorted);
  assert.deepEqual(sorted.map((r) => r.source === "structural"), [true, true, true, true, false, false, true, false, true]);
  assert.equal(sorted[7].source, "starter");
});
