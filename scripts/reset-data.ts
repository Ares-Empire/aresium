// Clears all imported transactions and accounts, keeping your categories + rules.
// Handy for starting over after a test import.  Run: npm run reset:data
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

const txn = await prisma.transaction.deleteMany();
const acc = await prisma.account.deleteMany();
console.log(`Deleted ${txn.count} transactions and ${acc.count} accounts (categories kept).`);
await prisma.$disconnect();
