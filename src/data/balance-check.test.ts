import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { compareClosings, statementClosings } from "../../scripts/check-balances.js";
import { assertBalanceOnlyChanges } from "../../scripts/balance-parity.js";
import { accountDayClosings } from "../engine/balances.js";
import { readBankFile } from "../engine/readers/read.js";
import type { BankTxn } from "../engine/readers/types.js";
import { dashboardInputFromRows, type SourceRows } from "./queries.js";

const bankRows: BankTxn[] = [
  { externalId: "debit100", bookingDate: "2026-02-03", amount: "-100", balance: "900",
    currency: "EUR", description: "Fictional purchase", raw: {} },
  { externalId: "debit50", bookingDate: "2026-02-03", amount: "-50", balance: "850",
    currency: "EUR", description: "Fictional purchase", raw: {} },
];

test("server check uses declared bank order, independently of the engine chain", () => {
  const expected = [{ accountId: "current", date: "2026-02-03", balance: 850 }];
  assert.deepEqual(statementClosings(bankRows, "current", "oldest-first"), expected);
  assert.deepEqual(statementClosings(bankRows.slice().reverse(), "current", "newest-first"), expected);
  const shuffled = bankRows.slice().reverse().map((row) => ({
    ...row, id: row.externalId, accountId: "current", date: row.bookingDate,
    amount: Number(row.amount), balance: Number(row.balance), category: null,
  }));
  assert.deepEqual(compareClosings(accountDayClosings(shuffled), expected), []);
  const wrongOrder = statementClosings(bankRows, "current", "newest-first");
  assert.deepEqual(compareClosings(accountDayClosings(shuffled), wrongOrder), [
    { accountId: "current", date: "2026-02-03", reason: "different" },
  ]);
});

test("server check reports missing, different and uncertain days per account without amounts", () => {
  const expected = [{ accountId: "current", date: "2026-02-03", balance: 850 }];
  assert.deepEqual(compareClosings([], expected), [
    { accountId: "current", date: "2026-02-03", reason: "missing" },
  ]);
  assert.equal(compareClosings([{ ...expected[0], balance: 900, uncertain: false }], expected)[0].reason, "different");
  assert.equal(compareClosings([{ ...expected[0], uncertain: true }], expected)[0].reason, "uncertain");
  assert.throws(() => statementClosings([{ ...bankRows[0], balance: null }], "current", "oldest-first"),
    /no running balances/);
});

test("server adapter retains account ids, balances and payment ids without changing other dashboard fields", () => {
  const transaction = (
    accountId: string, id: string, amount: number, balance: number,
  ): SourceRows["transactions"][number] => ({
    id, accountId, externalId: id, source: "bank", bookingDate: new Date("2026-02-03T00:00:00Z"),
    valueDate: null, amount: new Prisma.Decimal(amount), balance: new Prisma.Decimal(balance), currency: "EUR",
    description: "Fictional purchase", counterparty: null, category: null, categoryId: null, tags: [],
    categorized: false, categorySource: null, recurring: false, city: null, country: null,
    trip: null, tripKind: null, placeType: null, raw: {}, createdAt: new Date("2026-02-04T00:00:00Z"),
  });
  const input = dashboardInputFromRows({
    transactions: [transaction("current", "a", -100, 900), transaction("savings", "b", 200, 200)], categories: [],
  }, new Date("2026-02-05T00:00:00Z"));
  assert.deepEqual(input.transactions.map((row) => [row.id, row.accountId, row.balance]),
    [["a", "current", 900], ["b", "savings", 200]]);
  assert.equal(assertBalanceOnlyChanges(input).balanceByDay["2026-02-05"], 1100);
});

test("server comparison reads the existing bank fixture's own running balances", async () => {
  const bytes = new Uint8Array(await readFile(new URL("../engine/fixtures/vrbank.csv", import.meta.url)));
  const file = readBankFile(bytes);
  const expected = statementClosings(file.transactions, "current", "oldest-first");
  const input = file.transactions.slice().reverse().map((row) => ({
    id: row.externalId, externalId: row.externalId, accountId: "current", date: row.bookingDate,
    amount: Number(row.amount), balance: row.balance == null ? null : Number(row.balance),
    currency: row.currency, description: row.description, category: null,
  }));
  assert.deepEqual(compareClosings(accountDayClosings(input), expected), []);
  assert.equal(expected.length, 2);
});
