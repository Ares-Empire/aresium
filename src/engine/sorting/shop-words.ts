// Shop names and bank texts are compared as words in one spelling, so "Müller", "MUELLER" and "Mueller" are
// the same word. The engine (matching) and scripts/build-shop-list.ts (building the list) share these functions.
//
// - lower case; ä/ö/ü as ae/oe/ue and ß as ss; ø as o; other accents dropped (café → cafe)
// - apostrophes removed (McDonald's → mcdonalds)
// - a word is a run of letters and digits (O2, HUK24 and DB2026101234 are one word each, so a reference code
//   never contains "db"); "&" and "+" are words of their own (H&M → h & m, R+V → r + v); every other sign
//   separates words
const umlauts: Readonly<Record<string, string>> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };
const bareVowels: Readonly<Record<string, string>> = { ä: "a", ö: "o", ü: "u", ß: "ss" };

function words(text: string, letters: Readonly<Record<string, string>>): string[] {
  const plain = text.normalize("NFC").toLowerCase()
    .replace(/[äöüß]/gu, (c) => letters[c])
    .normalize("NFD").replace(/\p{M}+/gu, "").replace(/ø/gu, "o")
    .replace(/['’‘`´]/gu, "");
  return plain.match(/[\p{L}\p{N}]+|[&+]/gu) ?? [];
}

/** The words of a bank text or a shop name. */
export function shopWords(text: string): string[] {
  return words(text, umlauts);
}

// SEPA reference fields carry codes, not words (EREF: DB-2026-1234, MREF: DM-77).
export function withoutShopReferences(text: string): string {
  return text.replace(/\b(?:eref|mref|cred|kref|iban|bic|mandatsreferenz|mandatsref|gläubiger-id|glaeubiger-id|kundenreferenz)\s*[:+]\s*\S+/giu, " ");
}

// These endings describe a food business even in compounds (Stadtcafé, Fischimbiss). Deliberately no general
// stemming: "back" would include Backup and "grill" could be equipment. Used only for hand-written word rules;
// merchant identities and exact brand spellings keep their original words.
const foodEndings = ["restaurant", "imbiss", "baeckerei", "cafe", "backstube", "hofladen"];
export function foodBusinessWord(word: string): string | null {
  return foodEndings.find((ending) => word.length >= ending.length + 2 && word.endsWith(ending)) ?? null;
}

/** Descriptive compounds with a business ending, never arbitrary stemming (Grillparzer, Kaffeefahrt). */
export function businessWord(word: string): string | null {
  if (/^grill(?:huette|hutte|haus|stube|imbiss|restaurant)$/u.test(word)) return "grill";
  if (/^kaffee(?:kontor|contor|haus|stube|bar|roesterei|rosterei)$/u.test(word)) return "cafe";
  if (/^(?:haar(?:werkstatt|studio|atelier|design)|hair(?:design|studio|styling|style|stylist))$/u.test(word)) return "friseur";
  if (/^lebensmittel(?:markt|laden|handel|geschaeft)$/u.test(word)) return "lebensmittel";
  if (word === "baumkuchenhaus") return "konditorei";
  return foodBusinessWord(word);
}

/** Cutoffs count only at the end of this field (or the merchant column of a structured card line). */
export function businessFieldWords(text: string): string[] {
  const cleaned = withoutShopReferences(text.trimEnd());
  const words = shopWords(cleaned);
  // Inspect the original field ending too: removing a reference must not manufacture a cutoff.
  const tail = words.at(-1);
  if (cleaned.endsWith(" ") || !tail || !/[\p{L}.…]\s*$/u.test(text)) return words;
  if (/^lebensmit(?:t(?:e(?:l)?)?)?$/u.test(tail)) words[words.length - 1] = "lebensmittel";
  if (/^hairst(?:y(?:l(?:e)?)?)?$/u.test(tail)) words[words.length - 1] = "hairstyle";
  // "Podo" alone could be a name. A practice explicitly naming the field establishes podiatry.
  if (/^podo(?:l(?:o(?:g(?:i(?:e)?)?)?)?)?$/u.test(tail)
    && /(?:^| )praxis (?:fuer|fur) podo[a-z]*$/u.test(words.join(" "))) words[words.length - 1] = "podolog";
  return words;
}

/**
 * The spellings a shop name can take in a bank text: umlauts as ae/oe/ue, and, as some card terminals print
 * them, as plain vowels (Müller → mueller, muller), unless that plain spelling is another word (`otherWords`:
 * Küchen → kuchen is cake). Each spelling is its words joined by single spaces.
 */
export function shopSpellings(name: string, otherWords: ReadonlySet<string> = new Set()): string[] {
  const spellings = [shopWords(name).join(" ")];
  // Some terminals print the apostrophe as a space (O'Neill → O NEILL).
  if (/['’‘`´]/u.test(name)) spellings.push(shopWords(name.replace(/['’‘`´]/gu, " ")).join(" "));
  if (/[äöü]/iu.test(name)) {
    const plain = words(name, bareVowels).join(" ");
    if (!otherWords.has(plain)) spellings.push(plain);
    // Some card encodings replace an umlaut with a blank. Require enough remaining letters and full fragments.
    const blanks = shopWords(name.replace(/[äöü]/giu, " ")).join(" ");
    if (!otherWords.has(plain) && blanks.replace(/[^a-z]/gu, "").length >= 5) spellings.push(blanks);
  }
  return [...new Set(spellings)].filter(Boolean);
}

/** Letters and digits only: how long a name is, for the rule that very short names must be listed by hand. */
export function compactLength(name: string): number {
  return shopWords(name).filter((w) => w !== "&" && w !== "+").join("").length;
}
