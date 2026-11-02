import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { buildDashboard, type Dashboard } from "../data/dashboard.js";
import { buildSampleSource } from "../data/sample-source.js";
import { buildDashboardSource, type DashboardSourceInput, type SourceCategory, type SourcePayment, type SourceReceipt } from "./source.js";

// Invented payments only. The sides stay fixed so the assertions also cover money in under a spending category.
const categories: SourceCategory[] = ["Food", "Friends", "Travel", "Cash", "Transfer"].map((name) => ({
  name, icon: "Tag", color: "#123456", excludeFromTotals: name === "Transfer", side: "spend",
}));
const pay = (id: string, amount: number, date = "2026-01-02", fields: Partial<SourcePayment> = {}): SourcePayment => ({
  id, externalId: id, date, amount, currency: "EUR", category: "Food", description: "Fictional shop", ...fields,
});
const link = (payment: string, amount: number) => ({ payment, amount });
const build = (transactions: SourcePayment[], receipts?: SourceReceipt[]) => buildDashboard(buildDashboardSource({
  transactions, categories, today: "2026-03-31", ...(receipts === undefined ? {} : { receipts }),
}));
const txn = (d: Dashboard, id: string) => d.transactions.find((t) => t.id === id)!;
const receipt = (id: string, fields: Partial<SourceReceipt> = {}): SourceReceipt => ({
  id, date: "2026-01-03", total: 10, currency: "EUR", method: "cash", category: "Food",
  shop: "Fictional shop", paymentId: null, ...fields,
});

test("half paid back the next day lowers every spending and income view, including tags, on their own days", () => {
  const payments = [
    pay("meal", -80, "2026-01-02", { tags: ["Travel", "Travel", "Food"], balance: 920 }),
    pay("back", 60, "2026-01-03", { category: "Friends", tags: ["Travel"], balance: 980, paysBack: [link("meal", 40)] }),
  ];
  const plain = build(payments.map(({ paysBack, ...p }) => p));
  const d = build(payments);
  assert.deepEqual([d.total.expense, d.total.income], [40, 20]);
  assert.deepEqual(d.total.categories, [{ name: "Food", total: 40 }, { name: "Travel", total: 40 }]);
  assert.deepEqual(d.total.incomeBuckets, [{ name: "Friends", total: 20 }, { name: "Travel", total: 20 }]);
  const mo = d.byMonth["2026-01"];
  assert.deepEqual([mo.expense, mo.income, mo.categories, mo.incomeBuckets], [40, 20, d.total.categories, d.total.incomeBuckets]);
  assert.deepEqual(mo.dayExpense.slice(0, 4), [0, 40, 0, 0]);
  assert.deepEqual(mo.dayIncome.slice(0, 4), [0, 0, 20, 0]);
  assert.deepEqual(mo.dayExpenseRunning.slice(0, 4), [0, 40, 40, 40]);
  assert.deepEqual(d.overview, { expense: [40], income: [20], balance: plain.overview.balance });
  assert.deepEqual(mo.dayBalance, plain.byMonth["2026-01"].dayBalance);
  for (const name of ["Food", "Travel"]) {
    assert.deepEqual(d.spend[name].months, [40]);
    assert.deepEqual(d.spend[name].days["2026-01"].slice(0, 4), [0, 40, 0, 0]);
  }
  for (const name of ["Friends", "Travel"]) {
    assert.deepEqual(d.income[name].months, [20]);
    assert.deepEqual(d.income[name].days["2026-01"].slice(0, 4), [0, 0, 20, 0]);
  }
  assert.deepEqual(txn(d, "meal"), { ...txn(plain, "meal"), counted: -40, paidBack: 40, paidBackBy: [link("back", 40)] });
  assert.deepEqual(txn(d, "back"), { ...txn(plain, "back"), counted: 20, paysBack: [link("meal", 40)] });
  assert.ok(!("paybacksIgnored" in d));
  // Every list sums with the amount that counts; tags widen lists without widening the headline.
  for (const row of d.total.categories) assert.equal(d.transactions.filter((t) => t.categoriesIn.includes(row.name))
    .reduce((sum, t) => sum - (t.counted ?? t.amount), 0), row.total);
  for (const row of d.total.incomeBuckets) assert.equal(d.transactions.filter((t) => t.incomeBuckets.includes(row.name))
    .reduce((sum, t) => sum + (t.counted ?? t.amount), 0), row.total);
});

test("a later month's payback lowers the expense's month and day and the later month's income", () => {
  const d = build([
    pay("trip", -120, "2026-01-31", { category: "Travel" }),
    pay("back", 70, "2026-03-04", { category: "Friends", paysBack: [link("trip", 60)] }),
  ]);
  assert.deepEqual(d.overview.expense, [60, 0, 0]);
  assert.deepEqual(d.overview.income, [0, 0, 10]);
  assert.equal(d.byMonth["2026-01"].dayExpense[30], 60);
  assert.equal(d.byMonth["2026-01"].dayExpenseRunning[30], 60);
  assert.equal(d.byMonth["2026-03"].dayExpense[3], 0);
  assert.equal(d.byMonth["2026-03"].dayIncome[3], 10);
  assert.deepEqual(d.spend.Travel.months, [60, 0, 0]);
  assert.deepEqual(d.income.Friends.months, [0, 0, 10]);
  assert.deepEqual(d.byMonth["2026-02"].categories, []);
});

test("several payments pay one expense in parts, in booking-day then id order regardless of input order", () => {
  const expense = pay("meal", -100);
  const a = pay("a", 60, "2026-01-03T18:00:00Z", { paysBack: [link("meal", 60)] });
  const b = pay("b", 50, "2026-01-03T06:00:00Z", { paysBack: [link("meal", 50)] });
  const c = pay("c", 50, "2026-01-04", { paysBack: [link("meal", 50)] });
  for (const payments of [[c, b, expense, a], [a, expense, b, c]]) {
    const d = build(payments);
    assert.deepEqual([d.total.expense, d.total.income], [0, 60]);
    assert.deepEqual(txn(d, "meal").paidBackBy, [link("a", 60), link("b", 40)]);
    assert.deepEqual(txn(d, "b").paysBack, [link("meal", 40)]);
    assert.equal(txn(d, "b").counted, 10);
    assert.ok(!("paysBack" in txn(d, "c")));
    assert.ok(!("counted" in txn(d, "c")));
    assert.deepEqual(d.paybacksIgnored, [
      { from: "b", to: "meal", reason: "clamped", amount: 10 },
      { from: "c", to: "meal", reason: "clamped", amount: 50 },
    ]);
  }
});

test("one payment pays back two expenses and keeps a rest as income", () => {
  const d = build([
    pay("food", -20), pay("trip", -50, "2026-01-03", { category: "Travel" }),
    pay("back", 55, "2026-01-04", { category: "Friends", paysBack: [link("trip", 25), link("food", 20)] }),
  ]);
  assert.deepEqual([d.total.expense, d.total.income], [25, 10]);
  assert.deepEqual(txn(d, "back").paysBack, [link("trip", 25), link("food", 20)]);
  assert.deepEqual(txn(d, "back").incomeBuckets, ["Friends"]);
  assert.deepEqual(txn(d, "food").categoriesIn, ["Food"]);
  assert.deepEqual(d.total.categories, [{ name: "Travel", total: 25 }]);
});

test("both limits clamp in link order and report every euro that did not count", () => {
  const d = build([
    pay("small", -20), pay("large", -100),
    pay("back", 50, "2026-01-03", { paysBack: [link("small", 30), link("large", 40), link("large", 5)] }),
  ]);
  assert.deepEqual(txn(d, "back").paysBack, [link("small", 20), link("large", 30)]);
  assert.deepEqual([txn(d, "small").counted, txn(d, "large").counted, txn(d, "back").counted], [0, -70, 0]);
  assert.deepEqual(d.paybacksIgnored, [
    { from: "back", to: "small", reason: "clamped", amount: 10 },
    { from: "back", to: "large", reason: "clamped", amount: 10 },
    { from: "back", to: "large", reason: "clamped", amount: 5 },
  ]);
});

test("fully paid-back payments keep their direction lists and zero series; zero rows are omitted", () => {
  const d = build([
    pay("meal", -20, "2026-01-02", { tags: ["Travel"] }),
    pay("back", 20, "2026-01-03", { category: "Friends", paysBack: [link("meal", 20)] }),
    pay("unlinked", 0, "2026-01-04"),
  ]);
  assert.deepEqual([d.total.expense, d.total.income, d.total.categories, d.total.incomeBuckets], [0, 0, [], []]);
  assert.deepEqual(d.byMonth["2026-01"].categories, []);
  assert.deepEqual(d.byMonth["2026-01"].incomeBuckets, []);
  assert.deepEqual(txn(d, "meal").categoriesIn, ["Food", "Travel"]);
  assert.deepEqual(txn(d, "back").incomeBuckets, ["Friends"]);
  assert.deepEqual(d.spend.Food.months, [0]);
  assert.deepEqual(d.income.Friends.months, [0]);
  assert.ok(d.incomeBuckets.some((c) => c.name === "Friends"));
  assert.ok(!("counted" in txn(d, "unlinked")));
  assert.ok(!Object.is(txn(d, "meal").counted, -0));
});

const invalidEnds: { name: string; reason: string; target?: Partial<SourcePayment>; payer?: Partial<SourcePayment>; to?: string }[] = [
  { name: "missing target", reason: "target-missing", to: "gone" },
  { name: "incoming target", reason: "target-not-money-out", target: { amount: 10 } },
  { name: "zero target", reason: "target-not-money-out", target: { amount: 0 } },
  { name: "transfer target", reason: "target-transfer", target: { category: "Transfer", tags: ["Food"] } },
  { name: "transfer payer", reason: "payer-transfer", payer: { category: "Transfer", tags: ["Food"] } },
  { name: "withdrawal target", reason: "target-withdrawal", target: { description: "Bargeldauszahlung Geldautomat Fiktivbank" } },
  { name: "foreign target", reason: "target-not-euros", target: { currency: "USD" } },
  { name: "foreign payer", reason: "payer-not-euros", payer: { currency: "USD" } },
  { name: "outgoing payer", reason: "payer-not-money-in", payer: { amount: -10 } },
  { name: "zero payer", reason: "payer-not-money-in", payer: { amount: 0 } },
  { name: "PayPal funding payer", reason: "payer-not-counted", payer: { description: "Bank Deposit to PP Account" } },
];
for (const example of invalidEnds) test(`payback ignores and reports ${example.name}`, () => {
  const payments = [pay("target", -20, undefined, example.target),
    pay("payer", 10, "2026-01-03", { paysBack: [link(example.to ?? "target", 10)], ...example.payer })];
  const d = build(payments);
  const plain = build(payments.map(({ paysBack, ...p }) => p));
  const { paybacksIgnored, ...unchanged } = d;
  assert.deepEqual(unchanged, plain);
  assert.deepEqual(paybacksIgnored, [{ from: "payer", to: example.to ?? "target", reason: example.reason }]);
});

test("receipts, cash entries and covered rows cannot be targets, and the Cash page stays unchanged", () => {
  const cash = pay("atm", -30, undefined, { description: "Bargeldauszahlung Geldautomat Fiktivbank", category: "Cash" });
  const receipts = [receipt("cash"), receipt("card", { method: "card" }), receipt("gift", { direction: "in", date: "2026-01-05" })];
  const payer = pay("back", 50, "2026-01-04", {
    paysBack: [link("atm", 10), link("atm:covered", 10), link("cash", 10), link("card", 10), link("gift", 10)],
  });
  const d = build([cash, payer], receipts);
  const plain = build([cash, { ...payer, paysBack: [] }], receipts);
  const { paybacksIgnored, ...unchanged } = d;
  assert.deepEqual(unchanged, plain);
  assert.equal(txn(d, "atm").cashWithdrawal, true);
  assert.deepEqual(txn(d, "atm:covered").coveredBy, ["cash"]);
  assert.deepEqual(paybacksIgnored, [
    { from: "back", to: "atm", reason: "target-withdrawal" },
    ...["atm:covered", "cash", "card", "gift"].map((to) => ({ from: "back", to, reason: "target-missing" })),
  ]);
});

test("a stored payment joined to a card receipt can be paid back once", () => {
  const d = build([pay("shop", -20), pay("back", 10, "2026-01-04", { paysBack: [link("shop", 10)] })],
    [receipt("joined", { method: "card", paymentId: "shop", total: 20 })]);
  assert.equal(d.transactions.length, 2);
  assert.deepEqual([d.total.expense, d.total.income], [10, 0]);
  assert.ok(!("paybacksIgnored" in d));
});

const conversions = (purchase: string, euroAmount: number) => [
  pay(`${purchase}-foreign`, -euroAmount, undefined, { currency: "USD", raw: { Type: "General Currency Conversion", "Reference Txn ID": purchase } }),
  pay(`${purchase}-eur`, euroAmount, undefined, { raw: { Type: "General Currency Conversion", "Reference Txn ID": purchase } }),
];
test("a folded PayPal foreign purchase is paid back at its euro cost, with both conversion rows excluded", () => {
  const d = build([
    pay("purchase", -110, undefined, { currency: "USD", tags: ["Travel"] }), ...conversions("purchase", -90),
    pay("back", 100, "2026-01-03", { paysBack: [link("purchase", 100)] }),
  ]);
  assert.deepEqual([txn(d, "purchase").amount, txn(d, "purchase").counted, txn(d, "purchase").paidBack], [-90, 0, 90]);
  assert.equal(d.transactions.length, 2);
  assert.deepEqual([d.total.expense, d.total.income], [0, 10]);
  assert.deepEqual(d.paybacksIgnored, [{ from: "back", to: "purchase", reason: "clamped", amount: 10 }]);
});

test("folded-away PayPal rows cannot pay back or be paid back; a retained foreign refund uses its euros", () => {
  const rows = conversions("foreign-refund", 18);
  rows[1].paysBack = [link("shop", 10)];
  const d = build([
    pay("shop", -50), pay("foreign-refund", 20, undefined, { currency: "USD", paysBack: [link("shop", 18)] }), ...rows,
    pay("back", 10, "2026-01-03", { paysBack: [link("foreign-refund-eur", 5)] }),
  ]);
  assert.deepEqual([d.total.expense, d.total.income], [32, 10]);
  assert.deepEqual(txn(d, "foreign-refund").paysBack, [link("shop", 18)]);
  assert.deepEqual(d.paybacksIgnored, [
    { from: "foreign-refund-eur", to: "shop", reason: "payer-not-counted" },
    { from: "back", to: "foreign-refund-eur", reason: "target-not-counted" },
  ]);
});

test("nonpositive, nonfinite and fractional-cent links are ignored; valid cents sum exactly", () => {
  const d = build([
    pay("shop", -0.3), pay("back", 0.3, "2026-01-03", {
      paysBack: [0, -1, NaN, Infinity, 0.001, 1e-12].map((amount) => link("shop", amount)).concat([link("shop", 0.1), link("shop", 0.2)]),
    }),
  ]);
  assert.deepEqual(d.paybacksIgnored, Array.from({ length: 6 }, () => ({ from: "back", to: "shop", reason: "invalid-amount" })));
  assert.deepEqual([d.total.expense, d.total.income, txn(d, "shop").counted, txn(d, "back").counted], [0, 0, 0, 0]);
  assert.equal(txn(d, "shop").paidBack, 0.3);
  assert.deepEqual(txn(d, "back").paysBack, [link("shop", 0.1), link("shop", 0.2)]);
});

test("transfer tags do not prevent a link and unsorted payments retain their direction lists", () => {
  const d = build([
    pay("shop", -20, undefined, { category: null, tags: ["Transfer"] }),
    pay("back", 10, "2026-01-03", { category: null, tags: ["Transfer"], paysBack: [link("shop", 10)] }),
  ]);
  assert.deepEqual([d.total.expense, d.total.income], [10, 0]);
  assert.deepEqual(txn(d, "shop").categoriesIn, ["Uncategorised"]);
  assert.deepEqual(txn(d, "back").incomeBuckets, ["Uncategorised"]);
  assert.ok(!("paybacksIgnored" in d));
});

test("without an explicit side category menus use the counted net", () => {
  const d = buildDashboard(buildDashboardSource({
    categories: categories.map(({ side, ...c }) => c), today: "2026-03-31", transactions: [
      pay("shop", -100), pay("unlinked", 80),
      pay("back", 60, "2026-01-03", { category: "Friends", paysBack: [link("shop", 60)] }),
    ],
  }));
  assert.equal(d.categories.find((c) => c.name === "Food")!.kind, "income");
  assert.deepEqual(d.total.categories, [{ name: "Food", total: 40 }]);
  assert.deepEqual(d.total.incomeBuckets, [{ name: "Food", total: 80 }]);
});

test("links leave frozen inputs untouched and outputs independent and JSON-friendly", () => {
  const freeze = <T>(v: T): T => {
    if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); }
    return v;
  };
  const input: DashboardSourceInput = freeze({ categories, today: "2026-03-31", transactions: [
    pay("shop", -20), pay("back", 10, "2026-01-03", { paysBack: [link("shop", 10), link("gone", 1)] }),
  ] });
  const source = buildDashboardSource(input);
  const d = buildDashboard(source);
  assert.deepEqual(JSON.parse(JSON.stringify(d)), d);
  txn(d, "back").paysBack![0].amount = 2;
  txn(d, "shop").paidBackBy![0].amount = 3;
  d.paybacksIgnored![0].to = "changed";
  assert.equal(input.transactions[1].paysBack![0].amount, 10);
  assert.equal(source.transactions[1].paysBack![0].amount, 10);
  assert.equal(source.transactions[0].paidBackBy![0].amount, 10);
  assert.equal(source.paybacksIgnored![0].to, "gone");
});

test("without links the fictional sample dashboard stays byte-identical to before brief 201", () => {
  const d = buildDashboard(buildSampleSource());
  assert.equal(createHash("sha256").update(JSON.stringify(d)).digest("hex"),
    "6aafcfdee2c4356a64f5fbd7cb0867942d73b72f725d2ad8131e8a43a6ae7888");
  const payments = [pay("shop", -20), pay("back", 10)];
  assert.deepEqual(build(payments.map((p) => ({ ...p, paysBack: [] }))), build(payments));
});
