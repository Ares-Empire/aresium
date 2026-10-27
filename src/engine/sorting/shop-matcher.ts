import { BOOKING_TYPE, merchantKey, payeeText, type SortingPayment } from "./merchant.js";
import { shopSpellings, shopWords } from "./shop-words.js";

/**
 * Which way the money moves for a name to count: "out" only for money going out (spending words such as "Miete":
 * money from parents with "Miete und Unterhalt" is not rent), "in" only for money coming in (income words such as
 * "Gehalt"), "both" for shop names (money back from Zalando is a clothes refund) and transfers. A payment without an
 * amount, or with 0, has no known direction: every name counts.
 */
export type Direction = "out" | "in" | "both";
/** The shop list as stored in shops.de.json: [category id, names, direction] entries. */
export type ShopListData = {
  /** Hand-written word rules, in priority order. Without a direction, a block counts both ways. */
  rules: readonly (readonly [string, readonly string[], Direction?])[];
  /** Hand-written names that count only as the whole merchant name, or followed by a branch number. */
  merchants: readonly (readonly [string, readonly string[], Direction?])[];
  /** Merchants that have no numbered branches: a number after their name is something else ("CAMBIO 123 MADRID"). */
  noBranches?: readonly string[];
  /** Brands from the name-suggestion-index. */
  brands: readonly (readonly [string, readonly string[]])[];
  /** Plain-vowel spellings never used because they are other words (Küchen → "kuchen"). */
  plainVowelWords?: readonly string[];
};
export type StarterRule = { pattern: string; categoryId: string; source: "rule" | "merchant" | "brand"; direction: Direction };
export type ShopMatcher = {
  /** Every name, highest priority first. */
  rules: readonly StarterRule[];
  /** The category the list gives this payment, whatever the person's categories are; null if none. */
  match(payment: SortingPayment): string | null;
};

type Entry = { words: string[]; categoryId: string; rank: number; direction: Direction };
type Index = Map<string, Entry[]>;
type Merchant = { categoryId: string; direction: Direction };
type Money = "out" | "in" | null;

const moneyOf = (amount: number | undefined): Money =>
  typeof amount !== "number" || !Number.isFinite(amount) || amount === 0 ? null : amount < 0 ? "out" : "in";
const applies = (direction: Direction, money: Money) => money === null || direction === "both" || direction === money;

// SEPA reference fields carry codes, not words ("EREF: DB-2026-1234", "MREF: DM-77"): they are never matched.
// merchantKey cuts the same markers.
const references = /\b(?:eref|mref|cred|kref|iban|bic|mandatsreferenz|mandatsref|gläubiger-id|glaeubiger-id|kundenreferenz)\s*[:+]\s*\S+/giu;
// The text before the first number, and that number when it is a branch number: 2 to 6 digits standing alone, not
// part of a word ("4211A"), a price ("23,50") or a time ("12:34"). "PENNY 4211 GARCHING" → "penny ", "4211".
const branchNumber = /^((?:\D*[^\p{L}\p{N}])?)\d{2,6}(?![\p{L}\p{N}]|[.,:]\d)/u;

/**
 * Precompiles the list once: an index from a name's first word to the names starting with it, so a payment costs
 * one lookup per word of its text, not one test per name. Order of decision:
 * 1. hand-written word rules: a match inside a longer match gives way to it ("uber" inside "uber eats"), also when
 *    the longer one does not count for this direction of the money ("umbuchung flug" on money in is not an own
 *    transfer); otherwise the rule listed first wins;
 * 2. hand-written whole merchant names ("PENNY 1234 Berlin" is the merchant "penny"), or such a name at the start of
 *    who was paid, followed by a branch number ("PENNY 4211 GARCHING"; not "Penny Lane 3" or "Max Müller 12");
 * 3. brands: a match inside a longer match gives way to it; otherwise the name with more words, then more letters.
 * A name counts only in its direction (see Direction); the brands count both ways.
 */
export function compileShopList(list: ShopListData): ShopMatcher {
  const rules: StarterRule[] = [];
  const handWritten: Index = new Map(), brands: Index = new Map();
  const merchants = new Map<string, Merchant>();
  const seen = new Set<string>();
  const otherWords = new Set(list.plainVowelWords ?? []);
  const noBranches = new Set((list.noBranches ?? []).flatMap((name) => shopSpellings(name, otherWords)));
  // A spelling listed twice keeps its first (higher-priority) place.
  const add = (index: Index, name: string, categoryId: string, rank: number, direction: Direction) => {
    for (const spelling of shopSpellings(name, otherWords)) {
      if (seen.has(spelling)) continue;
      seen.add(spelling);
      const words = spelling.split(" ");
      const bucket = index.get(words[0]) ?? [];
      bucket.push({ words, categoryId, rank, direction });
      index.set(words[0], bucket);
    }
  };
  for (const [categoryId, names, direction = "both"] of list.rules) for (const name of names) {
    add(handWritten, name, categoryId, rules.length, direction);
    rules.push({ pattern: name, categoryId, source: "rule", direction });
  }
  for (const [categoryId, names, direction = "both"] of list.merchants) for (const name of names) {
    for (const spelling of shopSpellings(name, otherWords)) {
      if (!merchants.has(spelling)) merchants.set(spelling, { categoryId, direction });
    }
    rules.push({ pattern: name, categoryId, source: "merchant", direction });
  }
  const specificity = (name: string) => [shopWords(name).length, shopWords(name).join("").length] as const;
  const ranked = list.brands.flatMap(([categoryId, names]) => names.map((name) => ({ name, categoryId, size: specificity(name) })))
    .sort((a, b) => b.size[0] - a.size[0] || b.size[1] - a.size[1] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const { name, categoryId } of ranked) {
    add(brands, name, categoryId, rules.length, "both");
    rules.push({ pattern: name, categoryId, source: "brand", direction: "both" });
  }

  type Found = { start: number; end: number; entry: Entry };
  function find(index: Index, words: readonly string[]): Found[] {
    const found: Found[] = [];
    for (let start = 0; start < words.length; start++) {
      for (const entry of index.get(words[start]) ?? []) {
        const end = start + entry.words.length;
        if (end > words.length) continue;
        let same = true;
        for (let j = 1; j < entry.words.length && same; j++) same = words[start + j] === entry.words[j];
        if (same) found.push({ start, end, entry });
      }
    }
    return found;
  }
  /** The winner among `found`; a match inside a longer one of `covering` gives way, also to one for the other direction. */
  function best(found: readonly Found[], covering: readonly Found[], money: Money): string | null {
    let winner: Found | null = null;
    for (const m of found) {
      if (!applies(m.entry.direction, money)) continue;
      const inside = covering.some((o) => o.start <= m.start && o.end >= m.end && o.end - o.start > m.end - m.start);
      if (!inside && (!winner || m.entry.rank < winner.entry.rank)) winner = m;
    }
    return winner?.entry.categoryId ?? null;
  }

  /** A merchant name that starts who was paid, followed by a branch number: "PENNY 4211 GARCHING", "NORMA 12". */
  function branchMerchant(payment: SortingPayment): Merchant | null {
    const head = payeeText(payment).replace(BOOKING_TYPE, "").match(branchNumber)?.[1];
    const name = head === undefined ? "" : shopWords(head).join(" ");
    return name && !noBranches.has(name) ? merchants.get(name) ?? null : null;
  }

  return {
    rules,
    match(payment) {
      const money = moneyOf(payment.amount);
      const text = `${payment.counterparty ?? ""} ${payment.description ?? payment.bookingText ?? ""}`;
      const words = shopWords(text.replace(references, " "));
      const written = find(handWritten, words);
      const rule = best(written, written, money);
      if (rule) return rule;
      // A merchant found for the other direction decides too: Uber's money in is a driver's payout, not a ride.
      const merchant = merchants.get(shopWords(merchantKey(payment)).join(" ")) ?? branchMerchant(payment);
      if (merchant) return applies(merchant.direction, money) ? merchant.categoryId : null;
      // A hand-written name for the other direction also hides the brands inside it.
      const branded = find(brands, words);
      return best(branded, [...written, ...branded], money);
    },
  };
}
