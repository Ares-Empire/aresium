import { shopWords } from "./shop-words.js";

// The same finite big-city suffixes recognised by merchantKey. Used here without changing learned keys.
export const SHOP_TOWNS = ["münchen", "berlin", "hamburg", "köln", "frankfurt", "frankfurt am main", "stuttgart",
  "düsseldorf", "leipzig", "dresden", "hannover", "nürnberg", "bremen", "heidelberg", "mannheim", "karlsruhe",
  "augsburg", "bonn", "essen", "dortmund"];

/** Compare a known town with terminal spellings. Truncation needs an explicit card/country location field. */
export function townMatches(printed: string, town: string, cutoff = false): boolean {
  const actual = shopWords(printed).join(" ");
  const normal = shopWords(town).join(" ");
  if (!actual || !normal) return false;
  const variants = [normal, normal.replace(/ae|oe|ue/gu, (pair) => pair[0]),
    normal.replace(/ae|oe|ue/gu, " ").replace(/\s+/gu, " ").trim()];
  return variants.some((variant) => actual === variant || (cutoff && actual.replaceAll(" ", "").length >= 7
    && variant.startsWith(actual) && variant.length - actual.length <= 2));
}
