import type { SortingPayment } from "./merchant.js";
import { shopWords, withoutShopReferences } from "./shop-words.js";

/** Explicit purposes that need more than a single shop word. Learning still takes precedence. */
export function paymentPurpose(payment: SortingPayment): string | null {
  const words = shopWords(withoutShopReferences([payment.counterparty, payment.description, payment.bookingText].filter(Boolean).join(" ")));
  const has = (...names: string[]) => names.some((name) => words.includes(name));
  const amount = payment.amount;
  if (typeof amount === "number" && Number.isFinite(amount) && amount < 0) {
    // An explicit grocery purchase is clearer than a bakery's name (which otherwise permits a café snack).
    const purpose = shopWords(withoutShopReferences(payment.description || payment.bookingText || "")).join(" ");
    if (has("brot") && has("einkauf") && !purpose.includes("ihr einkauf bei")) return "groceries";
    // These delivery platforms also deliver pharmacy orders. A pharmacy identifies what was bought.
    if ((has("wolt") || ` ${words.join(" ")} `.includes(" uber eats ")) && has("apotheke")) return "health";
  }
  // These marketplaces pay private sellers. Their name alone could also mean a refund or a purchase.
  if (typeof amount === "number" && Number.isFinite(amount) && amount > 0
    && has("vinted", "kleiderkreisel", "ebay", "kleinanzeigen", "momox", "wirkaufens", "zoxs", "rebuy")
    && has("auszahlung", "verkauf", "verkaufserloes", "verkaufserloese")
    && !has("erstattung", "rueckerstattung", "rueckzahlung", "rueckgabe", "rueckabwicklung", "retoure", "refund", "stornierung", "storniert")) {
    return "selling-things";
  }
  return null;
}
