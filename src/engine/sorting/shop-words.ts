// Shop names and bank texts are compared as words in one spelling, so "Müller", "MUELLER" and "Mueller" are
// the same word. The engine (matching) and scripts/build-shop-list.ts (building the list) share these functions.
//
// - lower case; ä/ö/ü as ae/oe/ue and ß as ss; other accents dropped (café → cafe)
// - apostrophes removed (McDonald's → mcdonalds)
// - a word is a run of letters and digits (O2, HUK24 and DB2026101234 are one word each, so a reference code
//   never contains "db"); "&" and "+" are words of their own (H&M → h & m, R+V → r + v); every other sign
//   separates words
const umlauts: Readonly<Record<string, string>> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };
const bareVowels: Readonly<Record<string, string>> = { ä: "a", ö: "o", ü: "u", ß: "ss" };

function words(text: string, letters: Readonly<Record<string, string>>): string[] {
  const plain = text.normalize("NFC").toLowerCase()
    .replace(/[äöüß]/gu, (c) => letters[c])
    .normalize("NFD").replace(/\p{M}+/gu, "")
    .replace(/['’‘`´]/gu, "");
  return plain.match(/[\p{L}\p{N}]+|[&+]/gu) ?? [];
}

/** The words of a bank text or a shop name. */
export function shopWords(text: string): string[] {
  return words(text, umlauts);
}

/**
 * The spellings a shop name can take in a bank text: umlauts as ae/oe/ue, and, as some card terminals print
 * them, as plain vowels (Müller → mueller, muller), unless that plain spelling is another word (`otherWords`:
 * Küchen → kuchen is cake). Each spelling is its words joined by single spaces.
 */
export function shopSpellings(name: string, otherWords: ReadonlySet<string> = new Set()): string[] {
  const spellings = [shopWords(name).join(" ")];
  if (/[äöü]/iu.test(name)) {
    const plain = words(name, bareVowels).join(" ");
    if (!otherWords.has(plain)) spellings.push(plain);
  }
  return [...new Set(spellings)].filter(Boolean);
}

/** Letters and digits only: how long a name is, for the rule that very short names must be listed by hand. */
export function compactLength(name: string): number {
  return shopWords(name).filter((w) => w !== "&" && w !== "+").join("").length;
}
