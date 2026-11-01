import { BOOKING_TYPE, cardMerchant, payeeText, SHOP_PROCESSOR_PREFIX, type SortingPayment } from "./merchant.js";
import { townMatches } from "./towns.js";
import { shopWords } from "./shop-words.js";

/** Optional, separately loaded ODbL database. Never imported by the engine bundle. */
export type LocalPlacesData = {
  version: 1;
  attribution: string;
  source: string;
  dataDate: string;
  categories: readonly string[];
  towns: readonly string[];
  /** Sorted rows: name, national category (-1 requires a town), [town code, category code] pairs. */
  rows: readonly (readonly [string, number, readonly number[]])[];
};
export type LocalPlaceMatch = { categoryId: string; name: string; town: boolean };
export const localName = (text: string): string => shopWords(text).join(" ");

// This is a safety list, not a dictionary claim. Single words need eight letters in addition to this check.
// Shared by the builder and matcher, so a hand-supplied list cannot bypass the ordinary-word filter.
const ordinary = new Set(`lieblingsstueck lieblingsplatz glueck gluecklich zuhause daheim heimat freiheit liebe leben
  sonne mond stern himmel erde wasser feuer luft zeit raum mitte zentral central royal international express
  mueller muller schmidt schneider fischer weber meyer wagner becker schulz hoffmann schaefer koch richter klein wolf
  danke vielen dank einkauf zahlung rechnung gutschrift lastschrift ueberweisung dauerauftrag kartenzahlung
  gehalt lohn miete unterhalt erstattung rueckzahlung umbuchung auszahlung verkauf privat familie freunde
  terminal filiale beleg karte paypal klarna stripe adyen sumup zettle worldline nexi sparkasse volksbank
  deutschland germany berlin hamburg muenchen koeln leipzig restaurant cafe apotheke baeckerei blumen kosmetik
  optik praxis friseur hotel pension parkplatz supermarkt tankstelle shopping fashion beauty service services
  am markt am bahnhof am park zur post zur sonne zum stern
  an im in auf bei beim der die das dem den des ein eine und oder mit ohne fuer von vom`.split(/\s+/u));
const phrases = new Set(["am markt", "am bahnhof", "am park", "zur post", "zur sonne", "zum stern", "vielen dank"]);
export function safeLocalName(name: string): boolean {
  const words = name.split(" ");
  const letters = name.replace(/[^\p{L}]/gu, "").length;
  return name === localName(name) && letters >= 8 && name.length <= 100
    && !phrases.has(name) && !(words.length === 1 && ordinary.has(name))
    && words.some((word) => word.length >= 3 && !ordinary.has(word))
    && !/\b(?:iban|eref|mref|gmbh|inhaber|doktor|dr)\b/u.test(name);
}

function rowFor(data: LocalPlacesData, name: string): LocalPlacesData["rows"][number] | undefined {
  let low = 0, high = data.rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (data.rows[middle][0] < name) low = middle + 1; else high = middle;
  }
  return data.rows[low]?.[0] === name ? data.rows[low] : undefined;
}

/** Exact whole merchants only: no substring, fuzzy, truncated-name or reference-field matches. */
export function findLocalPlace(payment: SortingPayment, data: LocalPlacesData): LocalPlaceMatch | null {
  // Incoming money can be wages, transfers or a seller payout. We deliberately leave refunds to learning.
  if (data.version !== 1 || !(typeof payment.amount === "number" && Number.isFinite(payment.amount) && payment.amount < 0)) return null;
  const raw = payeeText(payment);
  const card = cardMerchant(raw);
  if (card && !/^deu\b/u.test(raw.slice(card.merchant.length).trim())) return null;
  const clean = (text: string) => localName(text.toLowerCase().replace(BOOKING_TYPE, "").replace(SHOP_PROCESSOR_PREFIX, "")
    .split(/\b(?:eref|mref|cred|iban|bic|mandatsreferenz|glaeubiger-id|gläubiger-id)\s*[:+]/iu)[0]);
  const head = clean(card?.merchant ?? raw);
  const details = clean(payment.description ?? payment.bookingText ?? "");
  const explicitTown = card ? localName(card.town) : "";
  const found: LocalPlaceMatch[] = [];
  const consider = (name: string, tail: string) => {
    if (!safeLocalName(name)) return;
    const row = rowFor(data, name);
    if (!row) return;
    const located = (text: string, town: string) => {
      const country = / (?:de|deu)$/u.test(text);
      return townMatches(text.replace(/ (?:de|deu)$/u, ""), town, country);
    };
    const location = (town: string) => (!tail && townMatches(explicitTown, town, true)) || located(tail, town)
      || (!tail && details.startsWith(`${name} `) && located(details.slice(name.length + 1), town));
    const categories = new Set<number>();
    for (let i = 0; i < row[2].length; i += 2) if (location(data.towns[row[2][i]])) categories.add(row[2][i + 1]);
    if (categories.size > 1) { found.push({ categoryId: "", name, town: true }); return; }
    const category = categories.size ? [...categories][0] : tail ? -1 : row[1];
    if (category >= 0 && data.categories[category]) found.push({ categoryId: data.categories[category], name, town: categories.size === 1 });
  };
  consider(head, "");
  // Only suffixes of this merchant field can be locations. Unknown extra text blocks a shorter name.
  const words = head.split(" ");
  for (let cut = 1; cut < words.length; cut++) consider(words.slice(0, cut).join(" "), words.slice(cut).join(" "));
  const specific = found.some((match) => match.town) ? found.filter((match) => match.town) : found;
  return specific.length && new Set(specific.map((match) => match.categoryId)).size === 1 && specific[0].categoryId ? specific[0] : null;
}
