// Applies keyword rules to all uncategorised transactions (without re-importing).
// Run: npm run categorize
import "dotenv/config";
import { categorizeAll } from "../src/sync/categorize.js";
import { prisma } from "../src/lib/db.js";

await categorizeAll();
await prisma.$disconnect();
