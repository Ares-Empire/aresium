import { pulseText, type Language } from "../lib/texts.js";
import type { Dashboard } from "./dashboard.js";

// One line for the Empire hub's Aresium card (docs/API-DATA.md → /api/pulse): this calendar month's spending, or a
// note when nothing is imported for it yet (the same rule as the iPhone widget). Pure, so it is testable.
export function pulseLine(dashboard: Dashboard, now: Date, language: Language = "en"): string {
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = dashboard.byMonth[key];
  return pulseText(month?.expense, now.getMonth(), language);
}
