import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { moneyReviewModule } from "../../scripts/money-review-module.js";
import { compareMoneySnapshot, type MoneySnapshot } from "../../scripts/check-money-review.js";
import { bundleEngine } from "../../scripts/build-engine.js";
import { buildDashboard } from "./dashboard.js";
import { buildSampleSource } from "./sample-source.js";
import { buildWebSample } from "./web-sample.js";
import { buildDashboardSource, type DashboardSourceInput } from "../engine/source.js";
import { buildLedgerDashboard, emptyLedgerSettings } from "../engine/ledger-dashboard.js";
import type * as Engine from "../engine/index.js";

const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const category = {
  id: "fictional-category", name: "Fictional category", icon: "Tag", color: "#123456", excludeFromTotals: false,
};

test("224: complete old/new dashboards are identical for the existing sample and bank fixtures", async (t) => {
  const baseline = await moneyReviewModule();
  try {
    const old = baseline.module;
    assert.deepEqual(json(buildDashboard(buildSampleSource())), json(old.buildDashboard(old.buildSampleSource())));
    assert.deepEqual(json(buildWebSample()), json(old.buildWebSample()));
    const directory = new URL("../engine/fixtures/", import.meta.url);
    const files = (await readdir(directory, { recursive: true })).filter((file) => file.endsWith(".expected.json"));
    for (const file of files) {
      const fixture = JSON.parse(await readFile(new URL(file, directory), "utf8"));
      const input: DashboardSourceInput = {
        today: "2026-11-03", categories: [category],
        transactions: fixture.transactions.map((p: Record<string, unknown>, index: number) => ({
          ...p, id: `fictional-${index}`, accountId: "fictional-account", date: p.bookingDate,
          amount: Number(p.amount), balance: p.balance == null ? null : Number(p.balance), category: category.name,
        })),
      };
      assert.deepEqual(buildDashboardSource(input), old.buildDashboardSource(input), file);
      assert.deepEqual(buildDashboard(buildDashboardSource(input)), old.buildDashboard(old.buildDashboardSource(input)),
        file);
    }
    t.diagnostic(`${files.length} existing bank fixtures and both complete samples compared before/after`);
  } finally {
    await baseline.close();
  }
});

function snapshot(name = category.name): MoneySnapshot {
  const c = { ...category, name };
  const transactions = [
    ["first", "2026-09-01", -100], ["second", "2026-10-01", -200], ["third", "2026-11-01", -10],
  ].map(([id, day, amount]) => ({
    id, externalId: id, accountId: "fictional-account", bookingDate: new Date(day + "T00:00:00Z"), amount,
    createdAt: new Date("2026-11-01T00:05:00Z"), currency: "EUR", description: "Fictional shop",
    counterparty: "Fictional shop", category: c, tags: [],
  }));
  return { categories: [c], allCategories: [c], transactions, settingsRow: null } as unknown as MoneySnapshot;
}

test("224: the server comparison accepts only the exact consequences of the three fixes", async () => {
  const baseline = await moneyReviewModule();
  try {
    const now = new Date("2026-11-03T12:00:00Z");
    const clean = snapshot();
    assert.deepEqual((await compareMoneySnapshot(baseline.module, clean, now)).changedDashboardFields, []);
    const duplicate = snapshot("Uncategorised");
    duplicate.transactions[0].category = null;
    const changed = await compareMoneySnapshot(baseline.module, duplicate, now);
    assert.deepEqual(changed.changedDashboardFields.sort(), ["byMonth", "categories", "total"]);
    const zero = snapshot();
    zero.transactions.forEach((p, index) => { p.amount = [0.1, 0.2, -0.3][index] as unknown as typeof p.amount; });
    assert.ok((await compareMoneySnapshot(baseline.module, zero, now)).changedDashboardFields.includes("pick"));
    const midnight = await compareMoneySnapshot(baseline.module, clean, new Date("2026-10-31T23:30:00Z"));
    assert.ok(midnight.changedDashboardFields.includes("monthlyAverage"));

    // An unrelated one-cent regression in the historical ledger oracle must fail, even in an affected field.
    const broken = {
      ...baseline.module,
      buildLedgerDashboard: (...args: Parameters<typeof baseline.module.buildLedgerDashboard>) => {
        const d = baseline.module.buildLedgerDashboard(...args);
        d.total.expense += 0.01;
        return d;
      },
    };
    await assert.rejects(compareMoneySnapshot(broken, duplicate, now), /Unexpected change in dashboard/);
  } finally {
    await baseline.close();
  }
});

test("224: cent nets and single Uncategorised rows match in the standalone engine bundle", async () => {
  const context = createContext({});
  runInContext(await bundleEngine(), context);
  const bundled = context.AresiumEngine as typeof Engine;
  const input: DashboardSourceInput = {
    today: "2026-11-03", categories: [{ ...category, name: "Uncategorised" }],
    transactions: [0.1, 0.2, -0.3].map((amount, index) => ({
      id: `fictional-${index}`, externalId: `fictional-${index}`, date: "2026-10-01", amount, currency: "EUR",
      description: "Fictional shop", category: index ? "Uncategorised" : null,
    })),
  };
  const source = buildDashboardSource(input);
  const d = buildDashboard(source);
  assert.equal(d.categories.length, 1);
  assert.equal(d.categories[0].kind, "spend");
  assert.deepEqual(json(bundled.buildDashboard(bundled.buildDashboardSource(input))), d);
  assert.deepEqual(
    json(bundled.buildLedgerDashboard(source, input.transactions.slice(), emptyLedgerSettings(), input.today)),
    json(buildLedgerDashboard(source, input.transactions.slice(), emptyLedgerSettings(), input.today)));
});
