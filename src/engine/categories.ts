export type CategoryKind = "spend" | "income" | "transfer";
export type Category = { id: string; name: { en: string; de: string }; group: string; kind: CategoryKind };

// Stable ids are the storage format. Display names follow the app's language.
const groups: [string, CategoryKind, [string, string, string][]][] = [
  ["Everyday", "spend", [
    ["groceries", "Groceries", "Lebensmittel"], ["drugstore", "Drugstore", "Drogerie"],
    ["eating-out", "Eating out", "Essen gehen"], ["coffee-snacks", "Coffee & snacks", "Kaffee & Snacks"],
  ]],
  ["Home", "spend", [
    ["rent", "Rent", "Miete"], ["utilities", "Utilities", "Nebenkosten"],
    ["internet-phone", "Internet & phone", "Internet & Handy"], ["household", "Household", "Haushalt"], ["pets", "Pets", "Haustiere"],
  ]],
  ["Getting around", "spend", [
    ["bus-train", "Bus & train", "Bus & Bahn"], ["car-fuel", "Car & fuel", "Auto & Tanken"],
    ["taxi-sharing", "Taxi & sharing", "Taxi & Sharing"], ["travel", "Travel", "Reisen"],
  ]],
  ["Health & care", "spend", [
    ["health", "Health", "Gesundheit"], ["sports-fitness", "Sports & fitness", "Sport & Fitness"],
    ["personal-care", "Personal care", "Körperpflege"],
  ]],
  ["Free time", "spend", [
    ["going-out", "Going out", "Ausgehen"], ["entertainment", "Entertainment", "Unterhaltung"],
    ["hobbies", "Hobbies", "Hobbys"], ["subscriptions", "Subscriptions", "Abos"],
  ]],
  ["Shopping", "spend", [
    ["clothes", "Clothes", "Kleidung"], ["electronics", "Electronics", "Elektronik"],
    ["shopping", "Shopping", "Shopping"], ["gifts", "Gifts", "Geschenke"],
  ]],
  ["Study & work", "spend", [["education", "Education", "Bildung"], ["work", "Work", "Arbeit"]]],
  // "cash" holds the withdrawals: "Cash withdrawals" / "Abhebungen" since brief 32 (D9), so "Bargeld" is the Cash page.
  ["Money", "spend", [
    ["insurance", "Insurance", "Versicherungen"], ["taxes", "Taxes", "Steuern"], ["fees", "Fees", "Gebühren"],
    ["memberships", "Memberships", "Mitgliedschaften"], ["donations", "Donations", "Spenden"], ["cash", "Cash withdrawals", "Abhebungen"],
    ["friends", "Friends", "Freunde"],
  ]],
  ["Money", "transfer", [["savings-investing", "Savings & investing", "Sparen & Anlegen"]]],
  ["Income", "income", [
    ["salary", "Salary & side jobs", "Gehalt & Nebenjob"], ["bafoeg-scholarships", "BAföG & scholarships", "BAföG & Stipendium"],
    ["parents-family", "Parents & family", "Eltern & Familie"], ["kindergeld", "Kindergeld", "Kindergeld"],
    ["selling-things", "Selling things", "Verkäufe"], ["interest-dividends", "Interest & dividends", "Zinsen & Dividenden"],
    ["other-income", "Other income", "Sonstige Einnahmen"],
  ]],
  ["Other", "spend", [["other", "Other", "Sonstiges"]]],
];
export const DEFAULT_CATEGORIES: readonly Category[] = groups.flatMap(([group, kind, entries]) =>
  entries.map(([id, en, de]) => ({ id, name: { en, de }, group, kind })));

// Not sorted is a pending spending entry until assigned; it is not a selectable default.
export const BUILT_IN_CATEGORIES: readonly Category[] = [
  { id: "own-transfers", name: { en: "Own transfers", de: "Eigene Umbuchungen" }, group: "Built in", kind: "transfer" },
  { id: "not-sorted", name: { en: "Not sorted", de: "Nicht sortiert" }, group: "Built in", kind: "spend" },
];

// How each default and built-in category looks: a Lucide icon name (the website's icon set; the iPhone app maps each
// to an SF Symbol in `CategorySymbol`) and a colour from the dashboard's palette. Chosen by Claude, 2026-10-27.
export type CategoryLook = { icon: string; color: string };
export const CATEGORY_LOOK: Readonly<Record<string, CategoryLook>> = {
  "groceries": { icon: "ShoppingCart", color: "#26E07A" },
  "drugstore": { icon: "SprayCan", color: "#10DBAE" },
  "eating-out": { icon: "Utensils", color: "#FF7A33" },
  "coffee-snacks": { icon: "Coffee", color: "#E0A458" },
  "rent": { icon: "House", color: "#6366FF" },
  "utilities": { icon: "Zap", color: "#FFD23F" },
  "internet-phone": { icon: "Smartphone", color: "#4FC3F7" },
  "household": { icon: "Sofa", color: "#B388FF" },
  "pets": { icon: "PawPrint", color: "#FF9F80" },
  "bus-train": { icon: "TrainFront", color: "#13C8E8" },
  "car-fuel": { icon: "Fuel", color: "#F25F5C" },
  "taxi-sharing": { icon: "CarTaxiFront", color: "#FFC857" },
  "travel": { icon: "Plane", color: "#3B82F6" },
  "health": { icon: "Pill", color: "#FF4D6D" },
  "sports-fitness": { icon: "Dumbbell", color: "#34E27A" },
  "personal-care": { icon: "Scissors", color: "#FF7AD9" },
  "going-out": { icon: "Beer", color: "#FFC02E" },
  "entertainment": { icon: "Ticket", color: "#FF6B9A" },
  "hobbies": { icon: "Palette", color: "#9B8CFF" },
  "subscriptions": { icon: "Tv", color: "#A36BFF" },
  "clothes": { icon: "Shirt", color: "#FF5CC8" },
  "electronics": { icon: "Laptop", color: "#8FA0C4" },
  "shopping": { icon: "ShoppingBag", color: "#C77BFF" },
  "gifts": { icon: "Gift", color: "#FF5C8A" },
  "education": { icon: "GraduationCap", color: "#FFB020" },
  "work": { icon: "Briefcase", color: "#7C8DB5" },
  "insurance": { icon: "Shield", color: "#5B8CFF" },
  "taxes": { icon: "Receipt", color: "#E0894A" },
  "fees": { icon: "Landmark", color: "#94A3B8" },
  "memberships": { icon: "Handshake", color: "#3DA0FF" },
  "donations": { icon: "HandHeart", color: "#FF6F91" },
  "cash": { icon: "Banknote", color: "#6BCB77" },
  "friends": { icon: "Users", color: "#2BB0FF" },
  "savings-investing": { icon: "TrendingUp", color: "#25E0B0" },
  "salary": { icon: "Wallet", color: "#25E07A" },
  "bafoeg-scholarships": { icon: "BookOpen", color: "#84CC16" },
  "parents-family": { icon: "HeartHandshake", color: "#2BB0FF" },
  "kindergeld": { icon: "Baby", color: "#7DD3FC" },
  "selling-things": { icon: "Package", color: "#F59E0B" },
  "interest-dividends": { icon: "Percent", color: "#22C55E" },
  "other-income": { icon: "Coins", color: "#A3E635" },
  "other": { icon: "Ellipsis", color: "#9CA3AF" },
  "own-transfers": { icon: "Repeat", color: "#9AA6B8" },
  "not-sorted": { icon: "CircleHelp", color: "#9CA3AF" },
};
/** A custom category's look until the person picks one: the tag icon and a neutral colour. */
export const CUSTOM_CATEGORY_LOOK: CategoryLook = { icon: "Tag", color: "#9CA3AF" };
export const categoryLook = (id: string): CategoryLook => CATEGORY_LOOK[id] ?? CUSTOM_CATEGORY_LOOK;
