import { pulseText, type Language } from "../lib/texts.js";
import type { Dashboard } from "./dashboard.js";
import { berlinDay } from "./calendar.js";

// One line for the Empire hub's Aresium card (docs/API-DATA.md → /api/pulse): this calendar month's spending, or a
// note when nothing is imported for it yet (the same rule as the iPhone widget). Pure, so it is testable.
export function pulseLine(dashboard: Dashboard, now: Date, language: Language = "en"): string {
  const key = berlinDay(now).slice(0, 7);
  const month = dashboard.byMonth[key];
  return pulseText(month?.expense, Number(key.slice(5)) - 1, language);
}
