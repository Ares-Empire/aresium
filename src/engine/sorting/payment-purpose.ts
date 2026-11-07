import { BOOKING_TYPE, cardMerchant, merchantKey, SHOP_PROCESSOR_PREFIX, sortingPayee, type SortingPayment } from "./merchant.js";
import { shopWords, withoutShopReferences } from "./shop-words.js";

/** Explicit purposes that need more than a single shop word. Learning still takes precedence. */
export function paymentPurpose(payment: SortingPayment): string | null {
  const words = shopWords(withoutShopReferences([payment.counterparty, payment.description, payment.bookingText].filter(Boolean).join(" ")));
  const has = (...names: string[]) => names.some((name) => words.includes(name));
  const amount = payment.amount;
  if (typeof amount === "number" && Number.isFinite(amount) && amount < 0) {
    // A canteen payment describes the purchase even when its host is an office or authority.
    if (has("kantine", "betriebskantine", "mensa")) return "eating-out";
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

/** Association names are a last resort: a known school, charity, sports venue or shop keeps its specific purpose. */
export function associationPurpose(payment: SortingPayment): string | null {
  if (!(typeof payment.amount === "number" && Number.isFinite(payment.amount) && payment.amount < 0)) return null;
  const payee = withoutShopReferences(payment.counterparty?.trim() || payment.description || payment.bookingText || "");
  return /\be\s*\.\s*v\.?(?=[^.\p{L}\p{N}]|$)/iu.test(payee)
    || /(?:^| )eingetragener verein(?: |$)/u.test(shopWords(payee).join(" ")) ? "memberships" : null;
}

const nonVenueBarWords = new Set(`cash bezahlt zahlung zahlen bezahlen gezahlt bez einzahlung auszahlung abhebung
  erstattung rueckzahlung rechnung betrag geld nail nails brow brows lash lashes beauty juice saft smoothie salat salad
  sushi snack snacks coffee kaffee espresso protein chocolate schoko schokolade riegel equipment zubehoer technik
  druck pressure consulting beratung association code codes de deu eur`.split(/\s+/u));

/** A named bar in an explicit card merchant descriptor; never German cash-payment prose or a bare "club". */
export function cardVenuePurpose(payment: SortingPayment): string | null {
  if (!(typeof payment.amount === "number" && Number.isFinite(payment.amount) && payment.amount < 0)) return null;
  const raw = sortingPayee(payment).toLowerCase().normalize("NFC").replace(BOOKING_TYPE, "");
  const card = cardMerchant(raw);
  if (!card && !SHOP_PROCESSOR_PREFIX.test(raw)) return null;
  const merchant = (card?.merchant ?? raw).replace(SHOP_PROCESSOR_PREFIX, "");
  const words = shopWords(merchantKey({ counterparty: merchant }));
  if (!words.includes("bar")) return null;
  // These describe a payment method, equipment, or another trade using "bar". More specific known businesses
  // have already been considered by the shop matcher; unknown food/beauty bars are left open here.
  if (words.some((word) => nonVenueBarWords.has(word))) return null;
  return words.some((word) => word !== "bar" && /^\p{L}{3,}$/u.test(word)) ? "going-out" : null;
}
