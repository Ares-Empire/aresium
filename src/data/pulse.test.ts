import test from "node:test";
import assert from "node:assert/strict";
import { pulseLine } from "./pulse.js";
import { buildDashboard, type Dashboard } from "./dashboard.js";
import { buildDashboardSource } from "../engine/source.js";

const dashboard = (months: Record<string, number>) => ({ byMonth: Object.fromEntries(
  Object.entries(months).map(([key, expense]) => [key, { expense }])) }) as unknown as Dashboard;

test("this month's spending, rounded to whole euros", () => {
  assert.equal(pulseLine(dashboard({ "2026-10": 1339.32 }), new Date(2026, 9, 24)), "€1,339 spent in October");
});

test("a new month without data says so instead of showing zero", () => {
  assert.equal(pulseLine(dashboard({ "2026-10": 1339.32 }), new Date(2026, 10, 1)), "Nothing imported for November yet");
});

test("refunds larger than spending leave the pulse's spending unchanged", () => {
  const source = buildDashboardSource({
    categories: [{ name: "Shopping", icon: "Tag", color: "#123456", excludeFromTotals: false, side: "spend" }],
    today: "2026-01-05",
    transactions: [-20, 32].map((amount, i) => ({
      id: `sample-${i}`, externalId: `sample-${i}`, date: "2026-01-02", amount, currency: "EUR",
      description: "Sample shop", category: "Shopping",
    })),
  });
  const data = buildDashboard(source);
  assert.deepEqual([data.total.expense, data.total.income], [20, 32]);
  assert.equal(pulseLine(data, new Date(2026, 0, 5)), "€20 spent in January");
  assert.equal(pulseLine(data, new Date(2026, 0, 5), "de"), "20 € im Januar ausgegeben");
});

test("a later payback lowers the pulse in the expense's month", () => {
  const data = buildDashboard(buildDashboardSource({
    categories: [{ name: "Shopping", icon: "Tag", color: "#123456", excludeFromTotals: false, side: "spend" }],
    today: "2026-02-05",
    transactions: [
      { id: "shop", externalId: "shop", date: "2026-01-02", amount: -80, currency: "EUR", description: "Fictional shop", category: "Shopping" },
      { id: "back", externalId: "back", date: "2026-02-02", amount: 40, currency: "EUR", description: "Fictional payback", category: "Shopping",
        paysBack: [{ payment: "shop", amount: 40 }] },
    ],
  }));
  assert.equal(pulseLine(data, new Date(2026, 0, 5)), "€40 spent in January");
  assert.equal(pulseLine(data, new Date(2026, 0, 5), "de"), "40 € im Januar ausgegeben");
  assert.equal(pulseLine(data, new Date(2026, 1, 5)), "€0 spent in February");
});

test("pulse translates all months and formats whole euros in both languages", () => {
  const months = {
    en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    de: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
  };
  for (const language of ["en", "de"] as const) {
    for (const [index, name] of months[language].entries()) {
      const now = new Date(2026, index, 24);
      const key = `2026-${String(index + 1).padStart(2, "0")}`;
      assert.equal(pulseLine(dashboard({ [key]: 1339.32 }), now, language),
        language === "de" ? `1.339 € im ${name} ausgegeben` : `€1,339 spent in ${name}`);
      assert.equal(pulseLine(dashboard({}), now, language),
        language === "de" ? `Für ${name} noch nichts importiert` : `Nothing imported for ${name} yet`);
    }
    for (const [amount, english, german] of [[0, "€0", "0 €"], [-12, "-€12", "-12 €"], [1339.5, "€1,340", "1.340 €"]] as const) {
      assert.equal(pulseLine(dashboard({ "2026-10": amount }), new Date(2026, 9, 24), language),
        language === "de" ? `${german} im Oktober ausgegeben` : `${english} spent in October`);
    }
  }
});
