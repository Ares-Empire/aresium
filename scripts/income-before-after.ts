// One-off (2026-10-27): total income on the real database, printed as totals only, to compare the dashboard before
// and after transfers stopped counting as income. Run from two checkouts (old and new); read only.
import "dotenv/config";
import { buildDashboard } from "../src/data/dashboard.js";
import { dashboardSourceFromRows, fetchSourceRows } from "../src/data/queries.js";
import { prisma } from "../src/lib/db.js";
try {
  const { source } = dashboardSourceFromRows(await fetchSourceRows(), new Date());
  const d = buildDashboard(source);
  const last = d.months.slice(-6).map((m) => `${m.key} ${Math.round(d.byMonth[m.key].income)}`).join(", ");
  console.log(`total income ${Math.round(d.total.income)}, spending ${Math.round(d.total.expense)}; last months: ${last}`);
  console.log(`income rows: ${d.total.incomeBuckets.map((b) => `${b.name} ${Math.round(b.total)}`).join(", ")}`);
} finally { await prisma.$disconnect(); }
