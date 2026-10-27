import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { DATA_FILE, type BenchPayment } from "./data.js";

// Entirely fictional, deterministic, covering all answer categories and 12 months.
// Markers make accidental disclosure in aggregate reports easy to detect.
// Accounts and IBANs are aliases, as the export writes them: a giro and a savings account with known IBANs, and PayPal.
const GIRO = { source: "bank", currency: "EUR", account: "account-1", accountIban: "iban-1" } as const;
const TAGESGELD = { source: "bank", currency: "EUR", account: "account-2", accountIban: "iban-2" } as const;
const PAYPAL = { source: "paypal", currency: "EUR", account: "account-3", accountIban: null } as const;
type Row = Omit<BenchPayment, "reference" | "description"> & { description: string };

// [answer, merchant, purpose, income], all on the giro account.
const examples: [string, string, string, number?][] = [
  ["Groceries", "REWE Markt GmbH", "REWE sagt danke"], ["Groceries", "ALDI Süd", "Einkauf"],
  ["Groceries", "LIDL", "Einkauf"], ["Drogerie", "dm-drogerie markt", "Einkauf"],
  ["Restaurants", "WOLT", "Abendessen"], ["Restaurants", "Bäckerei Morgen", "Frühstück"],
  ["Drinking", "Biergarten Sonnental", "Abend"], ["Clothes", "Zalando", "Kleidung"],
  ["Non-essentials", "IKEA", "Regal"], ["Tech", "MediaMarkt", "Kopfhörer"],
  ["Education", "Sprachschule Beispiel", "Kurs"], ["Travel", "DB Vertrieb GmbH", "Fahrkarte"],
  ["Travel", "Shell", "Kraftstoff"], ["Rent", "Wohnraum Beispiel", "Warmmiete"],
  ["Health", "Apotheke Beispiel", "Rezept"], ["Fitness", "FitX", "Beitrag"],
  ["Personal care", "Friseur Beispiel", "Haarschnitt"], ["Subscriptions", "Spotify", "Abo"],
  ["Memberships", "Amnesty", "Spende"], ["Basis", "Familienkasse", "Kindergeld", 250],
  ["Tax", "Finanzamt Beispiel", "Steuererstattung", 130], ["Income", "Werkstatt Beispiel", "Gehalt", 1200],
  ["Transfer", "Eigenes Sparkonto", "Eigenübertrag"],
  ["Development", "Codewolke Beispiel", "Serverkosten"], ["Trash", "Spielkiste Beispiel", "Spielmünzen"],
  ["Restaurants", "Esszimmer Beispiel", "Mittagessen"],
  ["Non-essentials", "Paketmarkt Beispiel", "Bestellung"],
  // Same merchant, conflicting preferences: exercises corrections and confusions.
  ["Groceries", "Mischladen Beispiel", "Lebensmittel"], ["Non-essentials", "Mischladen Beispiel", "Dekoration"],
  ["Income", "Förderwerk Beispiel", "Stipendium", 500],
];

// Rows for the structural rules, each month: two PayPal purchases as both exports show them (PayPal's row with the
// shop and its funding row; the bank's bare "PayPal" line), an own transfer to the savings account with its IBAN,
// and two unrelated payments of equal amounts on the two accounts, which must not pair.
function structured(month: number): Row[] {
  const day = (d: number) => `2025-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const rows: Row[] = [];
  for (const [k, [trueCategory, seller]] of ([["Subscriptions", "Streamingdienst Beispiel"], ["Tech", "Gerätekauf Beispiel"]] as const).entries()) {
    const amount = -(9.47 + 31 * k + month);
    rows.push(
      { ...PAYPAL, date: day(10 + k), amount, trueCategory, counterparty: seller, description: seller },
      { ...PAYPAL, date: day(10 + k), amount: -amount, trueCategory: "Transfer", counterparty: seller, description: "Bankgutschrift auf PayPal-Konto" },
      { ...GIRO, date: day(11 + k), amount, trueCategory: "Transfer", counterparty: "PayPal", description: `PP.4711.PP . Ihr Einkauf bei ${seller}` },
    );
  }
  const saved = 150.37 + month;
  rows.push(
    { ...GIRO, date: day(15), amount: -saved, trueCategory: "Transfer", counterparty: "Tagesgeld Beispiel", description: "Sparrate", counterpartyIban: "iban-2" },
    { ...TAGESGELD, date: day(16), amount: saved, trueCategory: "Transfer", counterparty: "Girokonto Beispiel", description: "Gutschrift" },
    { ...GIRO, date: day(20), amount: -23.47, trueCategory: "Restaurants", counterparty: "Pizzeria Beispiel", description: "Abendessen" },
    { ...TAGESGELD, date: day(21), amount: 23.47, trueCategory: "Restaurants", counterparty: "Freundin Beispiel", description: "Anteil Abendessen zurück" },
  );
  return rows;
}

export function fakeData(): BenchPayment[] {
  let index = 0;
  return Array.from({ length: 12 }, (_, month) => {
    const plain: Row[] = examples.map(([trueCategory, merchant, purpose, income], i) => {
      const branch = 100 + month;
      const city = month % 2 ? "München" : "Berlin";
      const n = month * examples.length + i;
      return { ...GIRO, date: `2025-${String(month + 1).padStart(2, "0")}-${String(1 + Math.floor(i * 27 / examples.length)).padStart(2, "0")}`,
        amount: income === undefined ? -(10 + n % 100 + 0.37) : income + 0.37, trueCategory,
        counterparty: `${merchant}${i < 4 ? ` Filiale ${branch} ${city}` : ""}`,
        description: `${purpose} CARD 123456789 ${month + 1}.01.2025 12:34` };
    });
    return [...plain, ...structured(month)].map((row) => {
      const reference = `fiction-${index}`;
      return { ...row, reference, description: `${row.description} MARKED_BOOKING_${index++}` };
    });
  }).flat();
}
export async function writeFakeData(): Promise<void> {
  const data = fakeData();
  await mkdir(new URL("out/", import.meta.url), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  console.log(`Wrote ${data.length} fictional payments over 12 months.`);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await writeFakeData();
