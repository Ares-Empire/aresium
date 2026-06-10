// Sanity-checks the dashboard query layer against the real data. Run: npm run data:check
import "dotenv/config";
import { prisma } from "../src/lib/db.js";
import { getOverview, getMonth, getCategory, getCategoryMonth } from "../src/data/queries.js";

const ov = await getOverview();
console.log("OVERVIEW — last 4 months:");
for (const p of ov.monthly.slice(-4)) {
  console.log(`  ${p.month}  spent ${p.expenses.toFixed(0).padStart(6)}  in ${p.income.toFixed(0).padStart(6)}  balance ${p.balance?.toFixed(0) ?? "—"}`);
}
console.log("  top spend categories:", ov.categories.filter((c) => !c.excluded && c.spend > 0).slice(0, 5).map((c) => `${c.name} ${c.spend.toFixed(0)}`).join(", "));

const lastMonth = ov.monthly[ov.monthly.length - 1].month;
const mo = await getMonth(lastMonth);
console.log(`\nMONTH ${lastMonth} — ${mo.daily.length} days, end balance ${mo.daily[mo.daily.length - 1].balance?.toFixed(0) ?? "—"}, top cat ${mo.categories[0]?.name}`);

const cat = await getCategory("Groceries");
console.log(`\nCATEGORY Groceries — ${cat?.monthly.length} months, last:`, cat?.monthly.slice(-3));

const cm = await getCategoryMonth("Groceries", lastMonth);
console.log(`\nGroceries × ${lastMonth} — ${cm?.places.length} places, sample:`);
for (const p of cm?.places.slice(0, 4) ?? []) console.log(`  ${p.date} ${p.amount.toFixed(2).padStart(8)}  ${p.place}${p.city ? " · " + p.city : ""}`);

await prisma.$disconnect();
