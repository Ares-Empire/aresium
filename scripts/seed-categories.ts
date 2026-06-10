// Defines the category taxonomy + conservative keyword rules, then RESETS and
// recreates them. Rules are intentionally high-precision (few false matches);
// the LLM categoriser handles everything they don't catch. Edit and re-run freely.
//
//   npm run seed       # reset categories/rules, detach transactions for re-categorising
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

type Cat = { name: string; color: string; icon: string; exclude?: boolean; patterns: string[] };

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
  { name: "Development", color: "#0ea5e9", icon: "🧑‍💻", patterns: ["anthropic", "claude.ai", "openai", "chatgpt", "hetzner", "github", "vercel", "namecheap", "digitalocean", "cloudflare", "supabase", "railway.app", "cursor "] },
  { name: "Trash", color: "#71717a", icon: "🗑️", patterns: ["onlyfans", "fanvue", "ccbill", "coppervex", "roblox", "fotoservice"] },
  { name: "Memberships", color: "#f59e0b", icon: "🤝", patterns: ["die linke", "mitgliedsbeitrag", "parteibeitrag", "spende", "greenpeace", "amnesty", "gewerkschaft"] },
  { name: "Basis", color: "#16a34a", icon: "👨‍👩‍👧", patterns: ["kindergeld"] },
  { name: "Tax", color: "#78716c", icon: "🧾", patterns: ["steuerverwaltung", "finanzamt", "einkommenst", "steuererstattung"] },
  { name: "Income", color: "#84cc16", icon: "💰", patterns: ["gehalt", "lohn", "stipendium", "bafög", "bafoeg", "erfrischungsgeld", "honorar"] },
  { name: "Transfer", color: "#94a3b8", icon: "🔁", exclude: true, patterns: ["paypal europe", "paypal (europe", "patrik breeck", "union investment", "uniondepot", "bankgutschrift auf paypal", "von nutzer eingeleitete abbuchung", "umbuchung", "eigenübertrag", "sparplan", "tagesgeld"] },
];

async function main() {
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
    await prisma.categoryRule.createMany({
      data: c.patterns.map((pattern) => ({ categoryId: cat.id, pattern })),
    });
  }

  const rules = await prisma.categoryRule.count();
  console.log(`Reset done. ${CATEGORIES.length} categories, ${rules} rules. Run \`npm run import\` or \`npm run categorize\` to apply.`);
  await prisma.$disconnect();
}

main();
