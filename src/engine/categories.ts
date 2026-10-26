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
  ["Money", "spend", [
    ["insurance", "Insurance", "Versicherungen"], ["taxes", "Taxes", "Steuern"], ["fees", "Fees", "Gebühren"],
    ["memberships", "Memberships", "Mitgliedschaften"], ["donations", "Donations", "Spenden"], ["cash", "Cash", "Bargeld"],
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
