import test from "node:test";
import assert from "node:assert/strict";
import { pulseLine } from "./pulse.js";
import type { Dashboard } from "./dashboard.js";

const dashboard = (months: Record<string, number>) => ({ byMonth: Object.fromEntries(
  Object.entries(months).map(([key, expense]) => [key, { expense }])) }) as unknown as Dashboard;

test("this month's spending, rounded to whole euros", () => {
  assert.equal(pulseLine(dashboard({ "2026-10": 1339.32 }), new Date(2026, 9, 24)), "€1,339 spent in October");
});

test("a new month without data says so instead of showing zero", () => {
  assert.equal(pulseLine(dashboard({ "2026-10": 1339.32 }), new Date(2026, 10, 1)), "Nothing imported for November yet");
});

test("refunds larger than spending show as a negative amount, not hidden", () => {
  assert.equal(pulseLine(dashboard({ "2026-01": -12 }), new Date(2026, 0, 5)), "-€12 spent in January");
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
