import type { Dashboard } from "./dashboard.js";

// One line for the Empire hub's Aresium card (docs/API-DATA.md → /api/pulse): this calendar month's spending, or a
// note when nothing is imported for it yet (the same rule as the iPhone widget). Pure, so it is testable.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"];
const euros = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export function pulseLine(dashboard: Dashboard, now: Date): string {
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = dashboard.byMonth[key];
  if (!month) return `Nothing imported for ${MONTHS[now.getMonth()]} yet`;
  return `${euros.format(month.expense)} spent in ${MONTHS[now.getMonth()]}`;
}
