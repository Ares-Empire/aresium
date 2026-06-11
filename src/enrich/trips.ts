// Detects trips: clusters of transactions in non-home locations, grouped by time.
// A lone away transaction (e.g. a DB charge in Frankfurt between home-town charges) is its
// own short "trip" — a travel stop. Multi-day clusters (a ski week in the Alps) form one.
// Each cluster also gets a tripKind so the categoriser can tell the two apart:
//   - "vacation": spending spread across ≥2 distinct days away → a real trip/holiday.
//   - "travel":   a single away stop (one day, often just transport) → en-route, not a stay.
// The label + kind are stored on each member transaction so the LLM categoriser (and the
// dashboard) can treat the spending appropriately.
import { prisma } from "../lib/db.js";
import { isHome } from "./location.js";

const GAP_MS = 4 * 86_400_000; // transactions within 4 days belong to the same trip
const VACATION_MIN_DAYS = 2;   // a cluster touching this many distinct days is a vacation

export async function detectTrips(): Promise<{ trips: number; vacations: number; transactions: number }> {
  await prisma.transaction.updateMany({ data: { trip: null, tripKind: null } });

  const withLoc = await prisma.transaction.findMany({
    where: { country: { not: null } },
    select: { id: true, city: true, country: true, bookingDate: true },
    orderBy: { bookingDate: "asc" },
  });
  const away = withLoc.filter(
    (t) => !isHome({ city: t.city ?? undefined, country: t.country ?? undefined }),
  );

  const clusters: (typeof away)[] = [];
  let current: typeof away = [];
  for (const t of away) {
    const last = current[current.length - 1];
    if (last && t.bookingDate.getTime() - last.bookingDate.getTime() <= GAP_MS) {
      current.push(t);
    } else {
      if (current.length) clusters.push(current);
      current = [t];
    }
  }
  if (current.length) clusters.push(current);

  let transactions = 0;
  let vacations = 0;
  for (const cl of clusters) {
    const counts = new Map<string, number>();
    for (const t of cl) {
      const key = `${t.city ?? "?"}, ${t.country}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const place = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const label = `${place} (${cl[0].bookingDate.toISOString().slice(0, 7)})`;
    // Distinct calendar days the cluster touches → vacation (a stay) vs travel (a stop).
    const distinctDays = new Set(cl.map((t) => t.bookingDate.toISOString().slice(0, 10))).size;
    const kind = distinctDays >= VACATION_MIN_DAYS ? "vacation" : "travel";
    if (kind === "vacation") vacations++;
    await prisma.transaction.updateMany({
      where: { id: { in: cl.map((t) => t.id) } },
      data: { trip: label, tripKind: kind },
    });
    transactions += cl.length;
  }

  return { trips: clusters.length, vacations, transactions };
}
