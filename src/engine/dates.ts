// Booking dates in the engine are ISO strings: `YYYY-MM-DD`, or a UTC timestamp whose first ten characters are the day.

export type Day = { y: number; m: number; d: number }; // m: 1–12

export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1–12

/** The calendar day an ISO date names, or null when it is not one (wrong shape, month 13, 30 February). */
export function parseDay(value: unknown): Day | null {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) ? { y, m, d } : null;
}

/** Days since 1970-01-01, for counting the days between two dates. */
export const dayNumber = (day: Day) => Date.UTC(day.y, day.m - 1, day.d) / 86_400_000;
