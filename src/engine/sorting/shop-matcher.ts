import { merchantKey, type SortingPayment } from "./merchant.js";
import { shopSpellings, shopWords } from "./shop-words.js";

/** The shop list as stored in shops.de.json: [category id, names] pairs. */
export type ShopListData = {
  /** Hand-written word rules, in priority order. */
  rules: readonly (readonly [string, readonly string[]])[];
  /** Hand-written names that count only as the whole merchant name. */
  merchants: readonly (readonly [string, readonly string[]])[];
  /** Brands from the name-suggestion-index. */
  brands: readonly (readonly [string, readonly string[]])[];
  /** Plain-vowel spellings never used because they are other words (Küchen → "kuchen"). */
  plainVowelWords?: readonly string[];
};
export type StarterRule = { pattern: string; categoryId: string; source: "rule" | "merchant" | "brand" };
export type ShopMatcher = {
  /** Every name, highest priority first. */
  rules: readonly StarterRule[];
  /** The category the list gives this payment, whatever the person's categories are; null if none. */
  match(payment: SortingPayment): string | null;
};

type Entry = { words: string[]; categoryId: string; rank: number };
type Index = Map<string, Entry[]>;

// SEPA reference fields carry codes, not words ("EREF: DB-2026-1234", "MREF: DM-77"): they are never matched.
// merchantKey cuts the same markers.
const references = /\b(?:eref|mref|cred|kref|iban|bic|mandatsreferenz|mandatsref|gläubiger-id|glaeubiger-id|kundenreferenz)\s*[:+]\s*\S+/giu;

/**
 * Precompiles the list once: an index from a name's first word to the names starting with it, so a payment costs
 * one lookup per word of its text, not one test per name. Order of decision:
 * 1. hand-written word rules: a match inside a longer match gives way to it ("uber" inside "uber eats"); otherwise
 *    the rule listed first wins;
 * 2. hand-written whole merchant names ("PENNY 1234 Berlin" is the merchant "penny");
 * 3. brands: a match inside a longer match gives way to it; otherwise the name with more words, then more letters.
 */
export function compileShopList(list: ShopListData): ShopMatcher {
  const rules: StarterRule[] = [];
  const handWritten: Index = new Map(), brands: Index = new Map();
  const merchants = new Map<string, string>();
  const seen = new Set<string>();
  const otherWords = new Set(list.plainVowelWords ?? []);
  // A spelling listed twice keeps its first (higher-priority) place.
  const add = (index: Index, name: string, categoryId: string, rank: number) => {
    for (const spelling of shopSpellings(name, otherWords)) {
      if (seen.has(spelling)) continue;
      seen.add(spelling);
      const words = spelling.split(" ");
      const bucket = index.get(words[0]) ?? [];
      bucket.push({ words, categoryId, rank });
      index.set(words[0], bucket);
    }
  };
  for (const [categoryId, names] of list.rules) for (const name of names) {
    add(handWritten, name, categoryId, rules.length);
    rules.push({ pattern: name, categoryId, source: "rule" });
  }
  for (const [categoryId, names] of list.merchants) for (const name of names) {
    for (const spelling of shopSpellings(name, otherWords)) if (!merchants.has(spelling)) merchants.set(spelling, categoryId);
    rules.push({ pattern: name, categoryId, source: "merchant" });
  }
  const specificity = (name: string) => [shopWords(name).length, shopWords(name).join("").length] as const;
  const ranked = list.brands.flatMap(([categoryId, names]) => names.map((name) => ({ name, categoryId, size: specificity(name) })))
    .sort((a, b) => b.size[0] - a.size[0] || b.size[1] - a.size[1] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const { name, categoryId } of ranked) {
    add(brands, name, categoryId, rules.length);
    rules.push({ pattern: name, categoryId, source: "brand" });
  }

  function best(index: Index, words: readonly string[]): string | null {
    const found: { start: number; end: number; entry: Entry }[] = [];
    for (let start = 0; start < words.length; start++) {
      for (const entry of index.get(words[start]) ?? []) {
        const end = start + entry.words.length;
        if (end > words.length) continue;
        let same = true;
        for (let j = 1; j < entry.words.length && same; j++) same = words[start + j] === entry.words[j];
        if (same) found.push({ start, end, entry });
      }
    }
    let winner: (typeof found)[number] | null = null;
    for (const m of found) {
      const inside = found.some((o) => o.start <= m.start && o.end >= m.end && o.end - o.start > m.end - m.start);
      if (!inside && (!winner || m.entry.rank < winner.entry.rank)) winner = m;
    }
    return winner?.entry.categoryId ?? null;
  }

  return {
    rules,
    match(payment) {
      const text = `${payment.counterparty ?? ""} ${payment.description ?? payment.bookingText ?? ""}`;
      const words = shopWords(text.replace(references, " "));
      const rule = best(handWritten, words);
      if (rule) return rule;
      const merchant = merchants.get(shopWords(merchantKey(payment)).join(" "));
      if (merchant) return merchant;
      return best(brands, words);
    },
  };
}
