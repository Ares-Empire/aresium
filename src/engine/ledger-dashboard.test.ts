import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboardSource, type SourcePayment } from "./source.js";
import { buildLedgerDashboard, emptyLedgerSettings } from "./ledger-dashboard.js";
const payments: SourcePayment[] = [
  {
    id: "old",
    externalId: "old-external",
    date: "2026-01-03",
    amount: -90,
    currency: "EUR",
    category: "Food",
    counterparty: "Apple Distribution International",
    description: "Fictional purchase"
  },
  {
    id: "new",
    externalId: "new-external",
    date: "2026-02-03",
    amount: -20,
    currency: "EUR",
    category: "Food",
    counterparty: "Apple Services",
    description: "Fictional purchase"
  },
  {
    id: "payback",
    externalId: "payback-external",
    date: "2026-02-04",
    amount: 45,
    currency: "EUR",
    category: "Food",
    counterparty: "Fictional Friend",
    description: "Fictional payback",
    paysBack: [{
      payment: "old",
      amount: 45
    }]
  },
];
const source = () => buildDashboardSource(
  {
    transactions: payments,
    today: "2026-03-03",
    categories: [
      {
        name: "Food",
        side: "spend",
        excludeFromTotals: false,
        icon: "Tag",
        color: "#123456"
      }
    ]
  });
test(
  "names follow shop identity, keep every bank spelling, and group only counted cents",
  () => {
    const d = buildLedgerDashboard(source(), payments, emptyLedgerSettings());
    assert.equal(d.transactions[0].place, "Apple Services");
    assert.equal(d.transactions[0].bankName, "Apple Distribution International");
    const group = d.nameGroups[d.transactions[0].nameKey!];
    assert.equal(group.moneyOut, 65);
    assert.equal(group.months["2026-01"].moneyOut, 45);
    assert.deepEqual(group.rows, ["new", "old"]);
    assert.ok(group.names.includes("Apple Distribution International"));
  });
test(
  "shop name, payment override and display preference preserve original names and ids",
  () => {
    const settings = emptyLedgerSettings();
    settings.names.apple = "Fictional Tools";
    settings.paymentNames.old = "Fictional Present";
    let d = buildLedgerDashboard(source(), payments, settings);
    assert.equal(d.transactions[0].place, "Fictional Present");
    assert.equal(d.transactions[1].place, "Fictional Tools");
    settings.ownNames = false;
    d = buildLedgerDashboard(source(), payments, settings);
    assert.equal(d.transactions[0].place, "Apple Services");
    assert.equal(d.transactions[0].ownName, "Fictional Present");
    assert.ok(d.nameGroups[d.transactions[0].nameKey!].names.includes("Fictional Tools"));
    assert.equal(payments[0].externalId, "old-external");
  });

test(
  "early-month Current uses the previous full month and sum rows use counted amounts",
  () => {
    const input = {
      transactions: [
        ...payments,
        {
          ...payments[0],
          id: "march",
          externalId: "march",
          date: "2026-03-01"
        }
      ],
      today: "2026-03-03",
      categories: [
        {
          name: "Food",
          side: "spend" as const,
          excludeFromTotals: false,
          icon: "Tag",
          color: "#123456"
        }
      ]
    };
    const d = buildLedgerDashboard(buildDashboardSource(input), input.transactions, emptyLedgerSettings(), input.today);
    assert.equal(d.currentMonth, "2026-02");
    const sums = d.summedLists[JSON.stringify(["Food", "2026-01", "spend"])];
    assert.equal(sums[0].amount, -45);
    assert.deepEqual(sums[0].ids, ["old"]);
    input.today = "2026-03-08";
    assert.equal(
      buildLedgerDashboard(
        buildDashboardSource(input),
        input.transactions,
        emptyLedgerSettings(),
        input
          .today).currentMonth,
      "2026-03");
  });

test(
  "summed withdrawal rows retain covered-cash adjustments, so the displayed rows still add to the category",
  () => {
    const cashPayments = [
      {
        ...payments[0],
        id: "withdrawal",
        externalId: "withdrawal",
        counterparty: "Geldautomat Fiktiv",
        amount: -100
      }
    ];
    const input = {
      transactions: cashPayments,
      categories: [
        {
          name: "Food",
          excludeFromTotals: false,
          side: "spend" as const,
          icon: "Tag",
          color: "#123456"
        }
      ],
      today: "2026-03-03",
      receipts: [
        {
          id: "cash-spend",
          date: "2026-01-04",
          total: 20,
          currency: "EUR",
          method: "cash" as const,
          direction: "out" as const,
          kind: "manual" as const,
          category: "Food",
          shop: "Fictional Shop",
          paymentId: null
        }
      ]
    };
    const d = buildLedgerDashboard(
      buildDashboardSource(input),
      [...cashPayments, {
        id: "cash-spend",
        counterparty: "Fictional Shop"
      }]);
    const rows = d.summedLists[JSON.stringify(["Food", "2026-01", "spend"])];
    assert.equal(rows.reduce((n, p) => n + p.amount, 0), -100);
    assert.equal(d.total.expense, 100);
    assert.equal(rows.find((p) => p.covered)?.amount, 20);
  });
