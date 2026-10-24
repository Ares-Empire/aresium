export type Language = "en" | "de";

// Only English and German participate; unsupported or malformed entries are ignored.
export function requestLanguage(header: string | string[] | undefined): Language {
  if (typeof header !== "string") return "en";
  let language: Language = "en", best = 0;
  for (const part of header.split(",")) {
    const match = /^([a-z]{1,8}(?:-[a-z0-9]{1,8})*)(?:\s*;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?$/i.exec(part.trim());
    if (!match) continue;
    const primary = match[1].split("-")[0].toLowerCase();
    const quality = match[2] === undefined ? 1 : Number(match[2]);
    if ((primary === "en" || primary === "de") && quality > best) {
      language = primary;
      best = quality;
    }
  }
  return language;
}

// API sentences live here. Names, source data and internal error codes stay unchanged.
const texts = {
  unauthenticated: { en: "Please log in again.", de: "Bitte melde dich erneut an." },
  forbidden: { en: "This account has no access to Aresium.", de: "Dieses Konto hat keinen Zugang zu Aresium." },
  authUnavailable: {
    en: "Login service unavailable, try again in a minute.",
    de: "Anmeldedienst nicht erreichbar, versuch es in einer Minute noch einmal.",
  },
  importRunning: { en: "An import is already running.", de: "Ein Import läuft bereits." },
  importTooLarge: { en: "Import exceeds the 25 MB request limit.", de: "Der Import überschreitet die Grenze von 25 MB pro Anfrage." },
  noFiles: { en: "Choose a .csv or .xml file to import.", de: "Wähle eine .csv- oder .xml-Datei zum Importieren." },
  camtDocument: { en: "This file is not a CAMT bank statement.", de: "Diese Datei ist kein CAMT-Kontoauszug." },
  camtType: { en: "Use a CAMT.052 or CAMT.053 bank statement.", de: "Verwende einen Kontoauszug im Format CAMT.052 oder CAMT.053." },
  paypalColumns: { en: "Required columns are missing from the PayPal CSV file.", de: "In der PayPal-CSV-Datei fehlen erforderliche Spalten." },
  bankColumns: { en: "Required columns are missing from the VR Bank CSV file.", de: "In der VR-Bank-CSV-Datei fehlen erforderliche Spalten." },
  invalidFile: { en: "This file could not be read. Check the export and try again.", de: "Diese Datei konnte nicht gelesen werden. Prüfe den Export und versuch es noch einmal." },
  importFailed: { en: "This file could not be imported. Try again in a minute.", de: "Diese Datei konnte nicht importiert werden. Versuch es in einer Minute noch einmal." },
  "not found": { en: "Transaction not found.", de: "Buchung nicht gefunden." },
  "unknown category": { en: "Category not found.", de: "Kategorie nicht gefunden." },
  "no categories": { en: "Choose at least one category.", de: "Wähle mindestens eine Kategorie." },
  categoryRequired: { en: "Choose a transaction and a category.", de: "Wähle eine Buchung und eine Kategorie." },
  categoriesRequired: { en: "Choose a transaction and its categories.", de: "Wähle eine Buchung und ihre Kategorien." },
  requestTooLarge: { en: "This request is too large.", de: "Diese Anfrage ist zu groß." },
  serverError: { en: "Something went wrong. Try again in a minute.", de: "Etwas ist schiefgegangen. Versuch es in einer Minute noch einmal." },
};

export function text(key: keyof typeof texts, language: Language): string {
  return texts[key][language];
}

const months = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  de: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
};
const euros = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const wholeNumbers = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const pulse = {
  en: { empty: (month: string) => `Nothing imported for ${month} yet`, spent: (amount: string, month: string) => `${amount} spent in ${month}` },
  de: { empty: (month: string) => `Für ${month} noch nichts importiert`, spent: (amount: string, month: string) => `${amount} im ${month} ausgegeben` },
};

export function pulseText(expense: number | undefined, month: number, language: Language): string {
  const name = months[language][month];
  if (expense === undefined) return pulse[language].empty(name);
  const amount = language === "de" ? `${wholeNumbers.format(expense)} €` : euros.format(expense);
  return pulse[language].spent(amount, name);
}
