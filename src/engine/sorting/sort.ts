import { cardMerchant, merchantKey, type SortingPayment } from "./merchant.js";
import { shopWords } from "./shop-words.js";
import { starterCategory } from "./starter-rules.js";
import { OWN_TRANSFERS, ownTransfers, type TransferPayment } from "./transfers.js";
export type Learned = Readonly<Record<string, string>>;
export type SortResult = { categoryId: string | null; source: "structural" | "learned" | "starter" | null };
// Order: structural (own transfers, ./transfers.ts; the built-in category, whatever the list), then learned (the
// person's own choice), then starter rules. Pass all of the person's payments: the transfer rules look across them.
export function sortPayments(payments: readonly TransferPayment[], options: {
  categories: readonly { id: string }[]; learned?: Learned;
}): SortResult[] {
  const allowed = new Set(options.categories.map((c) => c.id));
  const transfers = ownTransfers(payments);
  const provenTowns = new Set<string>();
  for (const payment of payments) for (const text of [payment.counterparty, payment.description, payment.bookingText]) {
    const card = text ? cardMerchant(text) : null;
    const words = card ? shopWords(card.town) : [];
    if (words.length === 1) provenTowns.add(words[0]);
  }
  const towns = [...provenTowns];
  return payments.map((payment, index) => {
    if (transfers[index]) return { categoryId: OWN_TRANSFERS, source: "structural" };
    const key = merchantKey(payment);
    const remembered = key && options.learned && Object.hasOwn(options.learned, key) ? options.learned[key] : null;
    if (remembered && allowed.has(remembered)) return { categoryId: remembered, source: "learned" };
    const categoryId = starterCategory(payment, options.categories, towns);
    return { categoryId, source: categoryId ? "starter" : null };
  });
}
export function learn(learned: Learned, payment: SortingPayment, categoryId: string): Learned {
  const key = merchantKey(payment);
  return key ? { ...learned, [key]: categoryId } : { ...learned };
}
