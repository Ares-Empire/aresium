// Seeds a starter set of categories and German-merchant matching rules.
// Idempotent: re-running updates colours/icons and adds any missing rules.
// Edit the list below and re-run to tune your own categories.
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

const CATEGORIES: { name: string; color: string; icon: string; patterns: string[] }[] = [
  { name: "Groceries", color: "#22c55e", icon: "🛒", patterns: ["rewe", "edeka", "aldi", "lidl", "penny", "netto", "kaufland", "rossmann", "tegut", "dm-drogerie"] },
  { name: "Eating out", color: "#f97316", icon: "🍔", patterns: ["mcdonald", "burger king", "lieferando", "uber eats", "wolt", "restaurant", "cafe", "kebab", "starbucks", "backwerk"] },
  { name: "Transport", color: "#3b82f6", icon: "🚆", patterns: ["deutsche bahn", "db vertrieb", "mvg", "mvv", "flixbus", "bvg", "tier", "lime", "sixt", "shell", "aral", "esso", "deutschlandticket"] },
  { name: "Rent & Utilities", color: "#8b5cf6", icon: "🏠", patterns: ["miete", "stadtwerke", "vattenfall", "e.on", "telekom", "vodafone", "o2", "1&1", "gez", "rundfunk"] },
  { name: "Subscriptions", color: "#ec4899", icon: "🔁", patterns: ["netflix", "spotify", "amazon prime", "disney", "youtube premium", "github", "openai", "anthropic", "icloud", "google one", "notion"] },
  { name: "Shopping", color: "#eab308", icon: "🛍️", patterns: ["amazon", "zalando", "mediamarkt", "saturn", "ikea", "h&m", "zara", "apple.com", "decathlon"] },
  { name: "Health", color: "#14b8a6", icon: "💊", patterns: ["apotheke", "arztpraxis", "barmer", "aok", "techniker", "mcfit", "fitx", "fitnessstudio"] },
  { name: "Education", color: "#0ea5e9", icon: "🎓", patterns: ["tum", "lmu", "studierendenwerk", "semesterbeitrag", "buch"] },
  { name: "Income", color: "#16a34a", icon: "💰", patterns: ["gehalt", "lohn", "stipendium", "bafög", "gutschrift", "payout", "erstattung"] },
  { name: "Cash", color: "#94a3b8", icon: "🏧", patterns: ["bargeldauszahlung", "geldautomat", "atm "] },
];

async function main() {
  for (const c of CATEGORIES) {
    const cat = await prisma.category.upsert({
      where: { name: c.name },
      create: { name: c.name, color: c.color, icon: c.icon },
      update: { color: c.color, icon: c.icon },
    });
    for (const pattern of c.patterns) {
      const exists = await prisma.categoryRule.findFirst({ where: { categoryId: cat.id, pattern } });
      if (!exists) await prisma.categoryRule.create({ data: { categoryId: cat.id, pattern } });
    }
  }
  const ruleCount = await prisma.categoryRule.count();
  console.log(`Seeded ${CATEGORIES.length} categories and ${ruleCount} rules.`);
}

main().finally(() => prisma.$disconnect());
