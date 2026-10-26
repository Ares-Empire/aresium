import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { DATA_FILE, type BenchPayment } from "./data.js";

// Entirely fictional, deterministic, covering all answer categories and 12 months.
// Markers make accidental disclosure in aggregate reports easy to detect.
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
  ["Subscriptions", "PayPal", "Streamingdienst Beispiel"], ["Tech", "PayPal", "Gerätekauf Beispiel"],
  ["Income", "Förderwerk Beispiel", "Stipendium", 500],
];
export function fakeData(): BenchPayment[] {
  return Array.from({ length: 12 }, (_, month) => examples.map(([trueCategory, merchant, purpose, income], i) => {
    const index = month * examples.length + i;
    const branch = 100 + month;
    const city = month % 2 ? "München" : "Berlin";
    return { reference: `fiction-${index}`, date: `2025-${String(month + 1).padStart(2, "0")}-${String(1 + Math.floor(i * 27 / examples.length)).padStart(2, "0")}`,
      amount: income === undefined ? -(10 + index % 100 + 0.37) : income + 0.37, trueCategory,
      counterparty: `${merchant}${i < 4 ? ` Filiale ${branch} ${city}` : ""}`,
      description: `${purpose} CARD 123456789 ${month + 1}.01.2025 12:34 MARKED_BOOKING_${index}`,
    };
  })).flat();
}
export async function writeFakeData(): Promise<void> {
  const data = fakeData();
  await mkdir(new URL("out/", import.meta.url), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  console.log(`Wrote ${data.length} fictional payments over 12 months.`);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await writeFakeData();
