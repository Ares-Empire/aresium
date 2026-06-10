// LLM categorisation pass (needs GROQ_API_KEY). Run AFTER `npm run enrich`.
//   npm run ai           # categorise only what rules left uncategorised
//   npm run ai -- --all  # re-evaluate everything except manual overrides
import "dotenv/config";
import { categorizeWithLLM } from "../src/enrich/llm.js";
import { prisma } from "../src/lib/db.js";

await categorizeWithLLM({ all: process.argv.includes("--all") });
await prisma.$disconnect();
