import type { SortingPayment } from "./merchant.js";
export type StarterRule = { pattern: string; categoryId: string };
// Literal, word-bounded patterns. Specific rules precede broader descriptions.
// No people, parties, personal services, or ambiguous marketplaces/processors.
const patterns: Record<string, string[]> = {
  "kindergeld": ["familienkasse", "kindergeld"],
  "taxes": ["finanzamt", "steuerverwaltung", "einkommensteuer", "steuererstattung"],
  "bafoeg-scholarships": ["bafög", "bafoeg", "stipendium", "stipendien"],
  "salary": ["gehalt", "gehaltszahlung", "lohn", "lohnzahlung", "honorar"],
  "own-transfers": ["eigenübertrag", "eigenuebertrag", "umbuchung", "bankgutschrift auf paypal", "bank deposit to pp account", "von nutzer eingeleitete abbuchung"],
  "savings-investing": ["sparplan", "tagesgeld", "union investment", "uniondepot"],
  "subscriptions": ["netflix", "spotify", "disney+", "disney plus", "youtube premium", "amazon prime", "dazn", "audible", "icloud", "google one"],
  "taxi-sharing": ["uber", "free now", "freenow", "bolt", "share now", "sharenow", "miles mobility", "cambio", "nextbike", "call a bike", "taxi"],
  "eating-out": ["uber eats", "mcdonald", "mcdonalds", "mcdonald's", "burger king", "kfc", "subway", "restaurant", "pizza", "pizzeria", "döner", "doener", "kebab", "imbiss", "bistro", "lieferando", "wolt", "mensa", "vapiano", "nordsee", "l'osteria", "losteria"],
  "coffee-snacks": ["bäckerei", "baeckerei", "backwerk", "ditsch", "starbucks", "coffee fellows", "café", "cafe"],
  "groceries": ["rewe", "edeka", "aldi", "lidl", "penny", "netto", "kaufland", "tegut", "hit fil", "interspar", "eurospar", "spar dankt", "spar markt", "denns", "dennree", "famila", "norma", "nahkauf", "e-center", "e center", "globus sb"],
  "drugstore": ["dm", "rossmann", "budni", "müller drogerie", "drogeriemarkt"],
  "bus-train": ["mvg", "mvv", "bvg", "hvv", "db", "deutsche bahn", "db vertrieb", "db fernverkehr", "bahn.de", "deutschlandticket", "flixbus", "flixtrain", "öbb", "oebb"],
  "car-fuel": ["aral", "shell", "esso", "totalenergies", "jet tankstelle", "avia", "tankstelle", "kfz-steuer", "kfz steuer", "atu", "autowäsche", "autowaesche", "parkhaus", "easypark"],
  "travel": ["booking.com", "airbnb", "ryanair", "eurowings", "lufthansa", "easyjet", "sixt", "bergbahn", "seilbahn"],
  "utilities": ["stadtwerke", "e.on", "eon energie", "enbw", "vattenfall", "rwe", "eprimo", "yello strom", "rundfunkbeitrag", "ard zdf", "nebenkosten"],
  "internet-phone": ["telekom", "vodafone", "o2", "telefonica", "1&1", "1und1", "congstar", "freenet", "sim.de", "simplytel", "blau mobilfunk"],
  "insurance": ["allianz", "huk-coburg", "huk24", "axa", "ergo versicherung", "debeka", "signal iduna", "gothaer", "r+v", "versicherung", "barmer", "techniker krankenkasse", "aok"],
  "fees": ["kontoführung", "kontofuehrung", "kontoführungsgebühr", "kontofuehrungsgebuehr", "kartenentgelt", "kontoentgelt", "abschlussentgelt", "bankgebühren"],
  "cash": ["bargeldauszahlung", "bargeldabhebung", "geldautomat", "atm withdrawal", "cash withdrawal"],
  "pets": ["fressnapf", "zooplus", "das futterhaus", "tierarzt", "tierklinik"],
  "household": ["ikea", "bauhaus", "obi", "hornbach", "toom", "höffner", "hoeffner", "xxxlutz", "mömax", "moemax", "jysk"],
  "entertainment": ["cinemaxx", "cinestar", "uci kino", "kinopolis", "mathäser", "mathaeser", "eventim", "ticketmaster", "kino"],
  "rent": ["kaltmiete", "warmmiete", "hausverwaltung", "miete"],
  "health": ["apotheke", "arztpraxis", "zahnarzt", "podolog", "physiotherapie", "klinik", "kontaktlinsen", "sanitätshaus", "brillen"],
  "sports-fitness": ["clever fit", "cleverfit", "finion", "mcfit", "fitx", "fitnessstudio", "urban sports", "body & soul", "kletterhalle", "boulder"],
  "personal-care": ["friseur", "hairstyling", "barber", "kosmetik", "nagelstudio"],
  "going-out": ["bar tapas", "cocktail", "brauhaus", "biergarten", "kneipe", "irish pub", "weinbar", "sports bar"],
  "clothes": ["zalando", "h&m", "h & m", "zara", "c&a", "primark", "tk maxx", "tkmaxx", "snipes", "about you", "aboutyou", "jack wolfskin", "humana"],
  "shopping": ["tedi", "woolworth", "kik fil", "flying tiger", "nanu-nana", "nanu nana", "euroshop", "tiger store"],
  "electronics": ["apple store", "mediamarkt", "media markt", "saturn", "cyberport", "notebooksbilliger", "conrad electronic", "gravis", "alternate"],
  "education": ["fahrschule", "semesterbeitrag", "technische universität", "hochschule", "sprachschule"],
  "memberships": ["mitgliedsbeitrag", "gewerkschaft"],
  "donations": ["spende", "greenpeace", "amnesty"],
};
// Uber Eats must precede Uber.
const order = Object.entries(patterns);
const eats = order.findIndex(([id]) => id === "eating-out");
const taxi = order.findIndex(([id]) => id === "taxi-sharing");
[order[eats], order[taxi]] = [order[taxi], order[eats]];
export const STARTER_RULES: readonly StarterRule[] = order.flatMap(([categoryId, entries]) =>
  entries.map((pattern) => ({ pattern, categoryId })));
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compiled = STARTER_RULES.map((rule) => ({ ...rule,
  re: new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(rule.pattern)}(?=$|[^\\p{L}\\p{N}])`, "iu") }));
export function starterCategory(payment: SortingPayment, categories: readonly { id: string }[]): string | null {
  const allowed = new Set(categories.map((c) => c.id));
  const text = `${payment.counterparty ?? ""} ${payment.description ?? payment.bookingText ?? ""}`.normalize("NFC");
  // Find the best matching rule before checking availability: a disabled specific
  // category must not fall through to a misleading broader rule (Uber Eats → Taxi).
  const rule = compiled.find(({ re }) => re.test(text));
  return rule && allowed.has(rule.categoryId) ? rule.categoryId : null;
}
