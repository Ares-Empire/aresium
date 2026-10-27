// A card receipt → the bank payment it belongs to, so the purchase counts once (decision D8, 2026-10-27). Exactly
// one exact match is joined; everything else is a question for the person ("Is this the same payment?"), never
// joined here.
import { dayNumber, parseDay } from "../dates.js";
import { merchantKey, type SortingPayment } from "../sorting/merchant.js";
import { shopWords } from "../sorting/shop-words.js";
import { findShop, type ShopFound } from "../sorting/starter-rules.js";

/** The receipt as stored: its day (`YYYY-MM-DD`), total, currency (null = EUR) and shop. */
export type MatchReceipt = { date: string; total: number; currency?: string | null; shop?: string | null };
/** A stored payment (SourcePayment has these fields). Negative amount = money out. */
export type MatchPayment = {
  id: string; date: string; amount: number; currency?: string | null; counterparty?: string | null; description?: string | null;
};
/**
 * Why a payment is asked about:
 * - "severalSame": one of two or more payments with the receipt's exact amount;
 * - "amountDiffers": the same shop, the bank amount larger by up to 200 (cash back at the till, a tip) or smaller
 *   by less than 2 %;
 * - "otherCurrency": the receipt is in another currency than the payment; matched on the days and the shop only.
 */
export type CandidateReason = "severalSame" | "amountDiffers" | "otherCurrency";
export type ReceiptCandidate = {
  id: string;
  why: CandidateReason;
  /** Days from the receipt to the booking (0–7). */
  days: number;
  /** Bank amount minus the receipt's total, in their currency (positive: the bank took more); null for another currency. */
  difference: number | null;
};
/** `exact`: the one payment to join without asking; otherwise `candidates` to ask about, best first (at most 5). */
export type ReceiptMatch = { exact: string | null; candidates: ReceiptCandidate[] };

const WINDOW_DAYS = 7;
const MORE_AT_MOST = 20_000; // cents: cash back or a tip
const LESS_UNDER = 0.02; // a fraction of the total
const MAX_CANDIDATES = 5;

// A bank text naming only a card processor or a wallet says nothing about the shop: unknown, not different. Removed
// as whole phrases, so a shop's own words stay ("Planet Sports" keeps "planet").
const PROCESSORS: readonly (readonly string[])[] = [
  "sumup", "zettle", "izettle", "sq", "stripe", "adyen", "worldline", "nexi", "concardis", "payone", "elavon", "telecash",
  "ingenico", "mollie", "klarna", "paypal", "ccv", "unzer", "computop", "fiserv", "vr payment", "global payments", "first data",
  "viva wallet", "apple pay", "google pay",
].map((name) => name.split(" "));
// Card booking words merchantKey leaves in the text.
const BOOKING = new Set(["girocard", "debitkarte", "debitk", "kreditkarte", "visa", "mastercard", "maestro", "vpay", "kontaktlos",
  "contactless", "karte", "card", "pos", "nfc", "kartenzahlung", "zahlung", "kaufumsatz", "terminal", "kfn", "uhr", "datum", "deu"]);
// Words of a shop's name that do not tell one shop from another.
const FILLERS = new Set(["markt", "filiale", "store", "shop", "gmbh", "ltd", "inc", "llc", "sa", "sl", "srl", "spa", "bv", "nv",
  "lda", "sas", "sarl", "und", "and", "the", "der", "die", "das", "le", "la", "il", "el", "de", "da", "di", "do", "van"]);

const chainLike = (found: ShopFound | null): found is ShopFound => !!found && (found.source !== "rule" || found.direction === "both");
/** A word the list only knows as a kind of shop ("bäckerei", "restaurant"): it does not name one shop. */
const generic = (word: string) => {
  const found = findShop({ counterparty: word, amount: -1 });
  return !!found && !chainLike(found);
};
const nameWords = (words: readonly string[], drop: (w: string) => boolean) => words.filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !drop(w));
/** The bank text's words without processors' and wallets' names. */
function withoutProcessors(words: readonly string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < words.length;) {
    const name = PROCESSORS.find((p) => p.every((w, k) => words[i + k] === w));
    if (name) i += name.length; else kept.push(words[i++]);
  }
  return kept;
}
/** Equal, or one cut short of the other (bank texts truncate names: "SCHM" for "SCHMIDT"). */
const sameWord = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

type ShopSide = "similar" | "unknown" | "different";
/** The receipt's shop, read once: the list's chain, its merchantKey and its own name words. */
type ReceiptShop = { chain: ShopFound | null; key: string; words: string[] } | null;

function receiptShop(shop: string | null | undefined): ReceiptShop {
  if (!shop?.trim()) return null;
  const receipt: SortingPayment = { counterparty: shop, amount: -1 };
  const found = findShop(receipt);
  const key = merchantKey(receipt);
  return { chain: chainLike(found) ? found : null, key, words: nameWords(shopWords(key), (w) => FILLERS.has(w) || generic(w)) };
}

/**
 * Whether the receipt's shop and the bank's text name the same shop: the shop list finds the same chain on both,
 * or the same merchantKey, or the receipt's own name words are all in the bank text. A bank text that names only a
 * card processor (or nothing) is unknown, as is a receipt without a shop.
 */
function sameShop(shop: ReceiptShop, payment: MatchPayment): ShopSide {
  if (!shop) return "unknown";
  const bank: SortingPayment = { counterparty: payment.counterparty ?? null, description: payment.description ?? "", amount: payment.amount };
  const theirs = findShop(bank);
  if (shop.chain && chainLike(theirs)) {
    // The same chain, or one name the start of the other ("aldi" and "aldi sued").
    const a = shop.chain.name.split(" "), b = theirs.name.split(" ");
    return a.every((w, i) => b[i] === undefined || b[i] === w) || b.every((w, i) => a[i] === undefined || a[i] === w) ? "similar" : "different";
  }
  if (shop.key && shop.key === merchantKey(bank)) return "similar";
  const bankWords = nameWords(withoutProcessors(shopWords(merchantKey(bank))), (w) => BOOKING.has(w));
  if (!bankWords.length || !shop.words.length) return "unknown";
  return shop.words.every((w) => bankWords.some((b) => sameWord(w, b))) ? "similar" : "different";
}

const cents = (n: number) => Math.round(n * 100);
const currencyOf = (code: string | null | undefined) => (code?.trim() || "EUR").toUpperCase();

export function matchReceipt(receipt: MatchReceipt, payments: readonly MatchPayment[], taken: readonly string[] = []): ReceiptMatch {
  const day = parseDay(receipt?.date);
  const total = receipt?.total;
  if (!day || typeof total !== "number" || !Number.isFinite(total) || total <= 0) return { exact: null, candidates: [] };
  const used = new Set(taken);
  const currency = currencyOf(receipt.currency);
  const shopOfReceipt = receiptShop(receipt.shop);
  type Found = ReceiptCandidate & { shop: ShopSide };
  const exact: Found[] = [], differs: Found[] = [], other: Found[] = [];

  for (const payment of payments ?? []) {
    const booked = parseDay(payment?.date);
    if (!booked || used.has(payment.id) || typeof payment.amount !== "number" || !(payment.amount < 0)) continue;
    const days = dayNumber(booked) - dayNumber(day);
    if (days < 0 || days > WINDOW_DAYS) continue;
    const shop = sameShop(shopOfReceipt, payment);
    if (shop === "different") continue;
    if (currencyOf(payment.currency) !== currency) {
      if (shop === "similar") other.push({ id: payment.id, why: "otherCurrency", days, difference: null, shop });
      continue;
    }
    const difference = cents(-payment.amount) - cents(total);
    if (difference === 0) exact.push({ id: payment.id, why: "severalSame", days, difference: 0, shop });
    else if (shop === "similar" && (difference > 0 ? difference <= MORE_AT_MOST : -difference < LESS_UNDER * cents(total))) {
      differs.push({ id: payment.id, why: "amountDiffers", days, difference: difference / 100, shop });
    }
  }
  if (exact.length === 1) return { exact: exact[0].id, candidates: [] };

  // Best first: exact amounts (a named shop before an unknown one, then the nearer day), then the smaller difference,
  // then another currency by day. The sort is stable, so equal ones keep the payments' order.
  const nearer = (a: Found, b: Found) => a.days - b.days;
  exact.sort((a, b) => (a.shop === b.shop ? 0 : a.shop === "similar" ? -1 : 1) || nearer(a, b));
  differs.sort((a, b) => Math.abs(a.difference!) - Math.abs(b.difference!) || nearer(a, b));
  other.sort(nearer);
  const candidates = [...exact, ...differs, ...other].slice(0, MAX_CANDIDATES).map(({ shop: _shop, ...candidate }) => candidate);
  return { exact: null, candidates };
}
