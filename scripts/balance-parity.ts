import assert from "node:assert/strict";
import { buildDashboard, type Dashboard, type DashboardSource } from "../src/data/dashboard.js";
import { legacyBuildDashboardSource } from "../src/engine/legacy-source.js";
import { buildDashboardSource, type DashboardSourceInput } from "../src/engine/source.js";

export function withoutSourceBalances(source: DashboardSource) {
  const { balanceByDay, openingBalance, balanceUncertainDays, ...rest } = source;
  return rest;
}

export function withoutDashboardBalances(dashboard: Dashboard) {
  const { balanceUncertainDays, overview, byMonth, ...rest } = dashboard;
  const { balance, ...overviewRest } = overview;
  return {
    ...rest,
    overview: overviewRest,
    byMonth: Object.fromEntries(Object.entries(byMonth).map(([key, month]) => {
      const { dayBalance, endBalance, ...monthRest } = month;
      return [key, monthRest];
    })),
  };
}

export function assertBalanceOnlyChanges(input: DashboardSourceInput) {
  const old = legacyBuildDashboardSource(input);
  const current = buildDashboardSource(input);
  assert.deepEqual(withoutSourceBalances(current), withoutSourceBalances(old));
  assert.deepEqual(withoutDashboardBalances(buildDashboard(current)), withoutDashboardBalances(buildDashboard(old)));
  return current;
}
