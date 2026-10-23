// Defines the category taxonomy + conservative keyword rules, then RESETS and
// recreates them. Rules are intentionally high-precision (few false matches);
// the LLM categoriser handles everything they don't catch. Edit and re-run freely.
//
//   npm run seed                   # reset categories/rules, detach transactions for re-categorising
//   npm run seed -- --rules-only   # only rebuild the rules; keeps every transaction's category + tags
import "dotenv/config";
import { prisma } from "../src/lib/db.js";
import { personal } from "../src/lib/personal.js";

// `alsoTag`: patterns that also tag the match into a second category (no double-counting,
// see TransactionTag). They get priority + 1 so they beat the same category's plain patterns
// (e.g. "claude sub" → Development + Subscriptions beats plain "anthropic" → Development).
type Cat = {
  name: string; color: string; icon: string; exclude?: boolean; priority?: number; patterns: string[];
  alsoTag?: { category: string; patterns: string[] };
};

const CATEGORIES: Cat[] = [
  { name: "Groceries", color: "#22c55e", icon: "🛒", patterns: ["rewe", "edeka", "aldi", "lidl", "penny", "netto ", "kaufland", "tegut", "hit 0", "hit fil", "interspar", "eurospar", "spar dankt", "spar markt", "denns", "dennree", "famila", "norma", "nahkauf", "e-center", "e center", "globus sb"] },
  { name: "Drogerie", color: "#06b6d4", icon: "🧴", patterns: ["dm drogerie", "dm drogeriemarkt", "dm-drogerie", "dm fil", "rossmann", "budni", "müller drogerie", "drogeriemarkt"] },
  { name: "Restaurants", color: "#f97316", icon: "🍔", patterns: ["mcdonald", "burger king", "kfc", "subway", "restaurant", "bäckerei", "baeckerei", "backwerk", "pizza", "döner", "doener", "kebab", "imbiss", "bistro", "lieferando", "uber eats", "wolt", "mensa", "riegler", "vapiano", "nordsee", "l'osteria", "losteria", "ditsch", "asia"] },
  { name: "Drinking", color: "#a855f7", icon: "🍺", patterns: ["bar tapas", "cocktail", "brauhaus", "biergarten", "kneipe", "irish pub", "weinbar", "sports bar"] },
  { name: "Clothes", color: "#ec4899", icon: "👕", patterns: ["vinted", "zalando", "h&m", "h & m", "zara", "c&a", "primark", "tk maxx", "tkmaxx", "snipes", "about you", "aboutyou", "jack wolfskin", "secondhand", "second hand", "kleider", "oxfam", "humana"] },
  { name: "Non-essentials", color: "#eab308", icon: "🛍️", patterns: ["tedi", "woolworth", "kik fil", "flying tiger", "nanu-nana", "nanu nana", "euroshop", "tiger store"] },
  { name: "Tech", color: "#64748b", icon: "💻", patterns: ["apple.com", "apple services", "apple store", "itunes", "mediamarkt", "media markt", "saturn", "cyberport", "notebooksbilli", "conrad electronic", "gravis", "alternate"] },
  { name: "Education", color: "#0ea5e9", icon: "🎓", patterns: ["fahrschule", "studierendenwerk", "studentenwerk", "semesterbeitrag", "tu münchen", "tu muenchen", "technische universität", "hochschule", "sprachschule"] },
  { name: "Travel", color: "#3b82f6", icon: "🚆", patterns: ["deutsche bahn", "db vertrieb", "db fernverkehr", "bahn.de", "flixbus", "flixtrain", "mvg", "mvv", "deutschlandticket", "talstation", "bergbahn", "seilbahn", "skiverleih", "intersport", "booking.com", "airbnb", "ryanair", "eurowings", "lufthansa", "easyjet", "sixt", "öbb", "oebb", "aral", "shell ", "esso", "tankstelle"] },
  { name: "Rent", color: "#8b5cf6", icon: "🏠", patterns: ["kaltmiete", "warmmiete", "hausverwaltung", "miete", "nebenkosten"] },
  { name: "Health", color: "#14b8a6", icon: "💊", patterns: ["apotheke", "arztpraxis", "zahnarzt", "podolog", "physiotherapie", "klinik", "optik", "kontaktlinsen", "simply", "brillen", "sanitätshaus", "barmer", "techniker krankenkasse", "aok "] },
  { name: "Fitness", color: "#f43f5e", icon: "🏋️", patterns: ["clever fit", "cleverfit", "finion", "mcfit", "fitx", "fitnessstudio", "urban sports", "body & soul", "kletterhalle", "boulder"] },
  { name: "Personal care", color: "#d946ef", icon: "💇", patterns: ["friseur", "hairstyl", "hairst.", "barber", "kosmetik", "nagelstudio", "movemodernverve"] },
  { name: "Subscriptions", color: "#ef4444", icon: "📺", patterns: ["netflix", "spotify", "disney", "youtube premium", "amazon prime", "dazn", "audible", "icloud", "google one", "notion", "patreon", "twitch", "playstation", "nintendo", "xbox"] },
  // One-off dev/AI spend (API credits, lookups) → Development only. Recurring dev costs
  // (servers, domains, AI/tool subscriptions) → Development, also tagged Subscriptions.
  { name: "Development", color: "#0ea5e9", icon: "🧑‍💻", patterns: ["anthropic", "openai", "leakcheck", "have i been pwned"],
    alsoTag: { category: "Subscriptions", patterns: ["claude sub", "claude.ai", "chatgpt", "github", "cursor ", "hetzner", "netcup", "namecheap", "vercel", "digitalocean", "cloudflare", "supabase", "railway.app", "webshare"] } },
  { name: "Trash", color: "#71717a", icon: "🗑️", patterns: ["onlyfans", "fanvue", "ccbill", "coppervex", "roblox", "fotoservice"] },
  { name: "Memberships", color: "#f59e0b", icon: "🤝", patterns: ["die linke", "mitgliedsbeitrag", "parteibeitrag", "spende", "greenpeace", "amnesty", "gewerkschaft"] },
  // priority 5: "who" (identity) rules beat "what" (merchant keyword) rules,
  // e.g. money from a parent with "Miete und Unterhalt" in the text is Basis, not Rent.
  // Names of people (family, yourself, landlord) live in config/personal.json → extraRules.
  { name: "Basis", color: "#16a34a", icon: "👨‍👩‍👧", priority: 5, patterns: ["kindergeld"] },
  { name: "Tax", color: "#78716c", icon: "🧾", priority: 5, patterns: ["steuerverwaltung", "finanzamt", "einkommenst", "steuererstattung"] },
  { name: "Income", color: "#84cc16", icon: "💰", priority: 5, patterns: ["gehalt", "lohn", "stipendium", "bafög", "bafoeg", "erfrischungsgeld", "honorar"] },
  { name: "Transfer", color: "#94a3b8", icon: "🔁", exclude: true, priority: 5, patterns: ["paypal europe", "paypal (europe", "union investment", "uniondepot", "bankgutschrift auf paypal", "bank deposit to pp account", "von nutzer eingeleitete abbuchung", "umbuchung", "eigenübertrag", "sparplan", "tagesgeld"] },
];

async function createRules(c: Cat, categoryId: string, idByName: Map<string, string>) {
  const priority = c.priority ?? 0;
  const patterns = [...c.patterns, ...(personal.extraRules[c.name] ?? [])];
  const data = patterns.map((pattern) => ({ categoryId, pattern, priority }));
  if (c.alsoTag) {
    const alsoTagId = idByName.get(c.alsoTag.category);
    if (!alsoTagId) throw new Error(`${c.name}: alsoTag category "${c.alsoTag.category}" is not defined`);
    data.push(...c.alsoTag.patterns.map((pattern) => ({ categoryId, pattern, priority: priority + 1, alsoTagId })));
  }
  await prisma.categoryRule.createMany({ data });
}

async function main() {
  const unknown = Object.keys(personal.extraRules).filter((n) => !CATEGORIES.some((c) => c.name === n));
  if (unknown.length) throw new Error(`config/personal.json extraRules: unknown categories ${unknown.join(", ")}`);
  const rulesOnly = process.argv.includes("--rules-only");
  const idByName = new Map<string, string>();

  if (rulesOnly) {
    // Keep categories (and so every transaction's category + tags); only replace the rules.
    // Categories missing from the DB are created; existing ones are left untouched.
    for (const c of CATEGORIES) {
      const cat = await prisma.category.upsert({
        where: { name: c.name },
        update: {},
        create: { name: c.name, color: c.color, icon: c.icon, excludeFromTotals: c.exclude ?? false },
      });
      idByName.set(c.name, cat.id);
    }
    await prisma.categoryRule.deleteMany();
  } else {
    // Reset: detach transactions, then rebuild the taxonomy from scratch.
    await prisma.transaction.updateMany({
      data: { categoryId: null, categorized: false, categorySource: null },
    });
    await prisma.categoryRule.deleteMany();
    await prisma.category.deleteMany();
    for (const c of CATEGORIES) {
      const cat = await prisma.category.create({
        data: { name: c.name, color: c.color, icon: c.icon, excludeFromTotals: c.exclude ?? false },
      });
      idByName.set(c.name, cat.id);
    }
  }

  for (const c of CATEGORIES) await createRules(c, idByName.get(c.name)!, idByName);

  const rules = await prisma.categoryRule.count();
  console.log(
    rulesOnly
      ? `Rules rebuilt: ${rules} rules across ${CATEGORIES.length} categories. Existing categorisations untouched.`
      : `Reset done. ${CATEGORIES.length} categories, ${rules} rules. Run \`npm run import\` or \`npm run categorize\` to apply.`,
  );
  await prisma.$disconnect();
}

main();
