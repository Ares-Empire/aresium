import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { bankFixtures } from "../../scripts/bank-fixtures.js";
import { buildDashboard } from "../data/dashboard.js";
import { accountDayClosings } from "./balances.js";
import { assertBalanceOnlyChanges } from "../../scripts/balance-parity.js";
import { readBankFile } from "./readers/read.js";
import { buildDashboardSource, type DashboardSourceInput, type SourcePayment } from "./source.js";

const categories = [
  { name: "Shopping", icon: "Tag", color: "#123456", excludeFromTotals: false },
  { name: "Transfer", icon: "Tag", color: "#123456", excludeFromTotals: true },
];
const pay = (id: string, date: string, amount: number, balance: number | null,
  fields: Partial<SourcePayment> = {}): SourcePayment => ({
  id, externalId: id, accountId: "current", date, amount, balance, currency: "EUR",
  description: "Fictional shop", category: "Shopping", ...fields,
});
const build = (transactions: SourcePayment[], today = "2026-02-10") =>
  buildDashboardSource({ transactions, categories, today });

function permutations<T>(rows: T[]): T[][] {
  if (!rows.length) return [[]];
  return rows.flatMap((row, i) => permutations(rows.filter((_, j) => i !== j)).map((rest) => [row, ...rest]));
}

test("brief 222: shuffled same-day debits close at 850 and carry across gap days and month boundaries", () => {
  const opening = pay("opening", "2026-01-30", 1000, 1000);
  const debits = [pay("debit100", "2026-01-31", -100, 900), pay("debit50", "2026-01-31", -50, 850)];
  const noBalance = pay("purchase", "2026-02-04", -2, null, { accountId: "paypal" });
  for (const rows of permutations([opening, ...debits, noBalance])) {
    const source = build(rows, "2026-02-05");
    const dashboard = buildDashboard(source);
    assert.equal(source.balanceByDay["2026-01-29"], null);
    assert.equal(source.balanceByDay["2026-01-30"], 1000);
    assert.equal(source.balanceByDay["2026-01-31"], 850);
    assert.deepEqual(dashboard.byMonth["2026-02"].dayBalance, [850, 850, 850, 850, 850]);
    assert.deepEqual(dashboard.overview.balance, [850, 850]);
    assert.equal(source.balanceUncertainDays, undefined);
  }
});

test("excluded transfers, PayPal funding and conversion rows keep their original account balances", () => {
  const rows = [
    pay("opening", "2026-02-02", 1000, 1000),
    pay("transfer", "2026-02-03", -100, 900, { category: "Transfer" }),
    pay("funding", "2026-02-03", -50, 850, { raw: { Type: "General Card Deposit" } }),
    pay("second", "2026-02-04", 250, 250, { accountId: "savings", category: "Transfer" }),
    pay("dollar", "2026-02-05", -12, null, { accountId: "paypal", currency: "USD", externalId: "USD" }),
    pay("conversion", "2026-02-05", -10, 240, {
      accountId: "savings", raw: { Typ: "Allgemeine Währungsumrechnung", "Zugehöriger Transaktionscode": "USD" },
    }),
  ];
  const source = build([rows[2], rows[0], rows[1], ...rows.slice(3)]);
  const dashboard = buildDashboard(source);
  assert.deepEqual(dashboard.byMonth["2026-02"].dayBalance, [null, 1000, 850, 1100, 1090,
    1090, 1090, 1090, 1090, 1090]);
  assert.deepEqual(source.transactions.map((row) => row.id), ["opening", "transfer", "second", "dollar"]);
  assert.equal(dashboard.total.expense, 10);
  assert.equal(source.balanceUncertainDays, undefined);
});

test("accounts carry independently and only join the sum at their first known balance, including zero", () => {
  const source = build([
    pay("unknown", "2026-02-01", -5, null),
    pay("a", "2026-02-03", -10, 0),
    pay("bUnknown", "2026-02-03", -1, null, { accountId: "savings" }),
    pay("b", "2026-02-05", 500, 500, { accountId: "savings" }),
    pay("a2", "2026-02-06", -5, -5),
  ]);
  assert.deepEqual(Object.values(source.balanceByDay), [null, null, 0, 0, 500, 495, 495, 495, 495, 495]);
  assert.equal(source.openingBalance, null);
  const dashboard = buildDashboard(build([pay("unknown", "2026-02-01", -5, null)]));
  assert.equal(dashboard.byMonth["2026-02"].endBalance, null);
  assert.deepEqual(dashboard.overview.balance, [null]);
  assert.ok(dashboard.byMonth["2026-02"].dayBalance.every((value) => value === null));
});

test("a filtered booking before the spending range still seeds its account's balance", () => {
  const source = build([
    pay("funding", "2026-01-31", 100, 100, { raw: { Type: "General Card Deposit" } }),
    pay("purchase", "2026-02-04", -2, null, { accountId: "paypal" }),
  ]);
  assert.deepEqual(source.months.map((month) => month.key), ["2026-02"]);
  assert.equal(source.openingBalance, 100);
  assert.ok(Object.values(source.balanceByDay).every((value) => value === 100));
});

test("disconnected chains and multiple closing candidates fall back to stored order and report account/day", () => {
  for (const rows of [
    [pay("a", "2026-02-03", -100, 900), pay("b", "2026-02-03", -50, 800)],
    [pay("a", "2026-02-03", -100, 900), pay("b", "2026-02-03", -50, 950)],
    [pay("a", "2026-02-03", -100, 900), pay("b", "2026-02-03", 100, 1000)],
  ]) {
    for (const shuffled of permutations(rows)) {
      const source = build(shuffled);
      assert.equal(source.balanceByDay["2026-02-03"], shuffled[1].balance);
      assert.equal(source.balanceByDay["2026-02-04"], shuffled[1].balance);
      assert.deepEqual(source.balanceUncertainDays, [{ accountId: "current", date: "2026-02-03" }]);
      assert.deepEqual(buildDashboard(source).balanceUncertainDays, source.balanceUncertainDays);
    }
  }
});

test("a branching but complete chain has one closing; cents and zero bookings do not break it", () => {
  const rows = [pay("a", "2026-02-03", -0.1, 0.2), pay("b", "2026-02-03", 0.1, 0.3),
    pay("zero", "2026-02-03", 0, 0.3), pay("last", "2026-02-03", -0.2, 0.1)];
  for (const shuffled of permutations(rows)) {
    assert.deepEqual(accountDayClosings(shuffled), [
      { accountId: "current", date: "2026-02-03", balance: 0.1, uncertain: false },
    ]);
  }
  assert.equal(build([pay("zero", "2026-02-03", 0, 0)]).balanceByDay["2026-02-03"], 0);
});

test("complete statement order resolves circuits and wins over row order; broken order is reported", () => {
  const a = pay("a", "2026-02-03", -100, 900, { statementOrder: 1 });
  const b = pay("b", "2026-02-03", 100, 1000, { statementOrder: 2 });
  for (const rows of [[a, b], [b, a]]) {
    assert.deepEqual(accountDayClosings(rows), [
      { accountId: "current", date: "2026-02-03", balance: 1000, uncertain: false },
    ]);
  }
  const broken = build([{ ...b, balance: 1100 }, a]);
  assert.equal(broken.balanceByDay["2026-02-03"], 1100);
  assert.equal(broken.balanceUncertainDays?.length, 1);
  // Incomplete or duplicate metadata cannot be treated as a bank statement sequence.
  for (const order of [undefined, 1]) {
    assert.equal(build([a, { ...b, statementOrder: order }]).balanceUncertainDays?.length, 1);
  }
});

test("missing account identity keeps the legacy single account; non-finite balances are rejected", () => {
  const a = pay("a", "2026-02-03", -100, 900, { accountId: undefined });
  const b = pay("b", "2026-02-03", -50, 850, { accountId: null });
  assert.equal(build([b, a]).balanceByDay["2026-02-03"], 850);
  for (const balance of [NaN, Infinity, -Infinity]) {
    assert.throws(() => build([{ ...a, balance }]), /Payment a: the balance is not a number/);
  }
});

test("existing bank fixtures through old and new sources and dashboards differ only in balance fields", async () => {
  let checked = 0;
  for (const name of await bankFixtures()) {
    const bytes = new Uint8Array(await readFile(new URL(`fixtures/banks/${name}`, import.meta.url)));
    let file;
    try { file = readBankFile(bytes); } catch { continue; }
    const transactions = file.transactions.map((row, i) => pay(`${name}-${i}`, row.bookingDate,
      Number(row.amount), row.balance == null ? null : Number(row.balance), {
        externalId: row.externalId, description: row.description, currency: row.currency,
        counterparty: row.counterparty, raw: row.raw, tags: ["Shopping"],
      }));
    const input: DashboardSourceInput = { transactions, categories, today: "2026-02-10" };
    assertBalanceOnlyChanges(input);
    checked++;
  }
  assert.equal(checked, 46, "all 46 readable existing bank fixtures were compared");
});
