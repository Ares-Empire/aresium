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
