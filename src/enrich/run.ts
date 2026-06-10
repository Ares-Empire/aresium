// Deterministic enrichment (no API key needed): location → trips → recurring.
// Run: npm run enrich
import "dotenv/config";
import { prisma } from "../lib/db.js";
import { applyLocations } from "./location.js";
import { detectTrips } from "./trips.js";
import { detectRecurring } from "./recurring.js";

const located = await applyLocations();
console.log(`Locations: tagged ${located} transactions with city/country.`);

const trips = await detectTrips();
console.log(`Trips: ${trips.trips} detected, covering ${trips.transactions} transactions.`);

const rec = await detectRecurring();
console.log(`Recurring: flagged ${rec.flagged} transactions across ${rec.groups.length} merchants:`);
for (const g of rec.groups) console.log(`  ${g.n}×  ${g.key}`);

await prisma.$disconnect();
